import { env, waitUntil } from "cloudflare:workers";

import { storeCover } from "./covers.server";
import type { Item } from "./db.server";
import { clip, DOUBAN_MOBILE_HEADERS, USER_AGENT } from "./providers.server";

/**
 * What a Douban import leaves out, looked up once per item in the background:
 * the summary and a few facts from Douban's own app API, and landscape artwork
 * for the wide cards (TMDB backdrops for films and series, Steam's library hero
 * for games), copied into R2 like covers.
 */

type DetailsItem = Pick<
  Item,
  "id" | "kind" | "title" | "original_title" | "year" | "source" | "source_id" | "summary"
> & {
  backdrop_key?: string | null;
  facts?: string | null;
  details_checked_at?: string | null;
};

/** Items looked up per request, to stay well inside the Workers subrequest limit. */
const PER_REQUEST = 4;

const needsLookup = (item: DetailsItem) => item.details_checked_at === null;

/** Starts lookups for items never looked up; the page shows what it has meanwhile. */
export function fillDetails(items: DetailsItem[]) {
  const pending = items.filter(needsLookup);
  if (pending.length) waitUntil(Promise.all(pending.slice(0, PER_REQUEST).map((item) => fill(item).done)));
}

/**
 * Looks one item up and waits up to `ms` for its summary, so a page opened for the
 * first time is not empty; the artwork, which takes longer, finishes in the background.
 * Returns whether a lookup ran, so the caller knows to read the item again.
 */
export async function fillDetailsNow(item: DetailsItem, ms = 3500) {
  if (!needsLookup(item)) return false;
  const { text, done } = fill(item);
  waitUntil(done);
  await Promise.race([text, new Promise((resolve) => setTimeout(resolve, ms))]);
  return true;
}

function fill(item: DetailsItem) {
  // Claim the item first, so overlapping requests do not look it up twice.
  const claimed = env.DB.prepare(
    "UPDATE items SET details_checked_at = datetime('now') WHERE id = ? AND details_checked_at IS NULL",
  )
    .bind(item.id)
    .run()
    .then((claim) => claim.meta.changes > 0);
  const quietly = (step: (item: DetailsItem) => Promise<void>) =>
    claimed
      .then((ok) => (ok ? step(item) : undefined))
      // Before migration 0006 the claim fails quietly, and pages keep what they have.
      .catch((error) => console.warn("details lookup failed", item.id, error));
  // Both steps read the Douban entry: the text for its intro, the game artwork for its English names.
  let subject: Promise<DoubanSubject | null> | undefined;
  const douban = () => (subject ??= doubanSubject(item));
  // A failed Douban request is retried on a later visit; a missing artwork match is not.
  const text = quietly((item) =>
    fillText(item, douban).catch(async (error) => {
      await env.DB.prepare("UPDATE items SET details_checked_at = NULL WHERE id = ?").bind(item.id).run();
      throw error;
    }),
  );
  return { text, done: Promise.all([text, quietly((item) => fillBackdrop(item, douban))]) };
}

type DoubanLookup = () => Promise<DoubanSubject | null>;

async function fillText(item: DetailsItem, douban: DoubanLookup) {
  if (item.summary && item.facts) return;
  const subject = await douban();
  const found = subject && doubanDetails(item, subject);
  if (!found) return;
  await env.DB.prepare("UPDATE items SET summary = COALESCE(NULLIF(summary, ''), ?), facts = COALESCE(facts, ?) WHERE id = ?")
    .bind(found.summary, found.facts.length ? JSON.stringify(found.facts) : null, item.id)
    .run();
}

async function fillBackdrop(item: DetailsItem, douban: DoubanLookup) {
  if (item.backdrop_key || (item.kind !== "screen" && item.kind !== "game")) return;
  const url = item.kind === "screen" ? await tmdbBackdrop(item) : await gameArt(item, await douban().catch(() => null));
  if (!url) return;
  const key = await storeCover(url);
  await env.DB.prepare("UPDATE items SET backdrop_url = ?, backdrop_key = ? WHERE id = ?").bind(url, key, item.id).run();
}

// Douban: the app's API answers for the ids Douban imports carry ("movie/36449242",
// "book/…", "game/…"); the web pages send servers to a captcha instead.

type DoubanSubject = {
  intro?: string;
  aliases?: string[];
  genres?: string[];
  countries?: string[];
  pubdate?: string[];
  durations?: string[];
  episodes_count?: number;
  is_tv?: boolean;
  press?: string[];
  pages?: string[];
  translator?: string[];
  platforms?: { cn_name?: string; name?: string }[];
  developers?: string[];
  publishers?: string[];
  release_date?: string;
};

/** Label and value pairs shown under 资料 on item pages. */
export type Facts = [string, string][];

async function doubanSubject(item: DetailsItem) {
  if (item.source.split(":")[0] !== "douban" || !item.source_id) return null;
  // Films and series share ids; the API redirects a series' movie/ path to tv/.
  const res = await fetch(`https://m.douban.com/rexxar/api/v2/${item.source_id}`, { headers: DOUBAN_MOBILE_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DoubanSubject;
}

function doubanDetails(item: DetailsItem, s: DoubanSubject): { summary: string | null; facts: Facts } {
  const join = (values: (string | null | undefined)[] | undefined, sep = " / ") =>
    values?.filter(Boolean).slice(0, 4).join(sep) || null;
  const rows: [string, string | null][] =
    item.kind === "book" || item.kind === "comic"
      ? [
          ["出版社", join(s.press)],
          ["出版", join(s.pubdate)],
          ["页数", join(s.pages)],
          ["译者", join(s.translator)],
        ]
      : item.kind === "game"
        ? [
            ["类型", join(s.genres)],
            ["平台", join(s.platforms?.map((p) => p.cn_name || p.name))],
            ["开发", join(s.developers)],
            ["发行", join(s.publishers)],
            ["发售", s.release_date || null],
          ]
        : [
            ["类型", join(s.genres)],
            ["地区", join(s.countries)],
            [s.is_tv ? "首播" : "上映", join(s.pubdate)],
            ["集数", s.is_tv && s.episodes_count ? String(s.episodes_count) : null],
            ["片长", join(s.durations)],
          ];
  return {
    summary: clip(tidy(s.intro)),
    facts: rows.filter((row): row is [string, string] => Boolean(row[1])),
  };
}

/** Douban intros indent paragraphs with ideographic spaces and leave stray blank lines. */
function tidy(text: string | undefined) {
  return text
    ?.split("\n")
    .map((line) => line.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ""))
    .filter(Boolean)
    .join("\n");
}

/** Season, part and broadcast-run markers: 第二季, Season 3, 第2期, 2期, 年番1, Part 2, III. */
const SEASON = /第[一二三四五六七八九十\d]+[季部期]|\d+期|年番\d*|season\s*\d+|part\s*\d+|\b(ii|iii|iv)\b/gi;

/** The name without season markers, for searching: TMDB lists a series once, not per season. */
export function seriesName(name: string) {
  return name.normalize("NFKC").replace(SEASON, " ").replace(/\s+/g, " ").trim();
}

/** Lowercase letters, digits and CJK only, without season markers, for comparing names across sources. */
export function normalizeName(name: string | null | undefined) {
  return seriesName(name ?? "")
    // "Pokémon" and "Pokemon" are the same name.
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function names(item: DetailsItem) {
  return [...new Set([item.title, item.original_title].map(normalizeName).filter((n) => n.length >= 2))];
}

// TMDB

type TmdbHit = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  backdrop_path?: string | null;
};

async function tmdb<T>(path: string, params: Record<string, string>) {
  const key = env.TMDB_API_KEY;
  if (!key) return null;
  const isToken = key.startsWith("eyJ");
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.search = new URLSearchParams({ language: "zh-CN", include_adult: "false", ...params }).toString();
  if (!isToken) url.searchParams.set("api_key", key);
  const res = await fetch(url, { headers: isToken ? { Authorization: `Bearer ${key}` } : {} });
  return res.ok ? ((await res.json()) as T) : null;
}

const tmdbImage = (path: string) => `https://image.tmdb.org/t/p/w1280${path}`;

async function tmdbBackdrop(item: DetailsItem) {
  // Items picked from TMDB know their id.
  if (item.source === "tmdb" && item.source_id) {
    const hit = await tmdb<TmdbHit>(item.source_id, {});
    return hit?.backdrop_path ? tmdbImage(hit.backdrop_path) : null;
  }
  const wanted = names(item);
  if (!wanted.length) return null;
  const queries = [...new Set([item.original_title, item.title].filter((q): q is string => Boolean(q)).map(seriesName))];
  let best: { hit: TmdbHit; score: number } | null = null;
  // Series whose name starts ours, e.g. "JOJO的奇妙冒险" for "JOJO的奇妙冒险 飙马野郎": the rest may name one of its seasons.
  const partial: { hit: TmdbHit; rest: string }[] = [];
  for (const query of queries) {
    const [movies, series] = await Promise.all([
      tmdb<{ results: TmdbHit[] }>("search/movie", { query, ...(item.year ? { year: String(item.year) } : {}) }),
      // A season's year is not the series' first year, so series are searched without it.
      tmdb<{ results: TmdbHit[] }>("search/tv", { query }),
    ]);
    for (const hit of series?.results ?? []) {
      for (const name of [hit.name, hit.original_name].map(normalizeName)) {
        const whole = wanted.find((w) => name.length >= 3 && w.length > name.length && w.startsWith(name));
        if (whole && !partial.some((p) => p.hit.id === hit.id)) partial.push({ hit, rest: whole.slice(name.length) });
      }
    }
    for (const hit of [...(movies?.results ?? []), ...(series?.results ?? [])]) {
      if (!hit.backdrop_path) continue;
      const hitNames = [hit.title, hit.name, hit.original_title, hit.original_name].map(normalizeName);
      if (!hitNames.some((n) => n && wanted.includes(n))) continue;
      const year = Number((hit.release_date ?? hit.first_air_date ?? "").slice(0, 4));
      // Same name is required; a matching or earlier first year breaks ties between remakes.
      const score = !item.year || !year ? 1 : year === item.year ? 3 : year < item.year ? 2 : 0;
      if (!best || score > best.score) best = { hit, score };
    }
    if (best && best.score >= 2) break;
  }
  if (best?.hit.backdrop_path) return tmdbImage(best.hit.backdrop_path);
  for (const { hit, rest } of partial) {
    const still = await seasonStill(hit.id, rest);
    if (still) return still;
  }
  return null;
}

type TmdbSeason = { season_number: number; name: string };

/**
 * A still from the first episode of the season named like `rest` ("飙马野郎" → "飙马野郎篇").
 * Seasons have posters but no backdrops on TMDB, and the series backdrop would show another part.
 */
async function seasonStill(seriesId: number, rest: string) {
  const series = await tmdb<{ seasons?: TmdbSeason[] }>(`tv/${seriesId}`, {});
  const season = series?.seasons?.find((s) => {
    const name = normalizeName(s.name).replace(/[篇章]$/, "");
    return s.season_number > 0 && name.length >= 2 && (rest.includes(name) || name.includes(rest));
  });
  if (!season) return null;
  const detail = await tmdb<{ episodes?: { still_path?: string | null }[] }>(
    `tv/${seriesId}/season/${season.season_number}`,
    {},
  );
  const still = detail?.episodes?.find((e) => e.still_path)?.still_path;
  return still ? tmdbImage(still) : null;
}

// Games: Steam's own library hero first, then SteamGridDB, whose community heroes cover
// Nintendo and PlayStation games too. Both are searched by the English name, which Douban
// keeps as the original title or among the aliases of Japanese games.

/** English (Latin-script) names of a game, from its original title and Douban aliases. */
function englishNames(item: DetailsItem, subject: DoubanSubject | null) {
  const names = [item.original_title, ...(subject?.aliases ?? [])].filter(
    (name): name is string => Boolean(name) && /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u.test(name!) && name!.length > 3,
  );
  return [...new Set(names)].slice(0, 3);
}

async function gameArt(item: DetailsItem, subject: DoubanSubject | null) {
  const english = englishNames(item, subject);
  return (await steamHero(item, english)) ?? (await steamGridHero(item, english));
}

type SteamHit = { type: string; name: string; id: number };

async function steamHero(item: DetailsItem, english: string[]) {
  const wanted = [...new Set([...names(item), ...english.map(normalizeName)])];
  const searches: [string, string, string][] = [
    ...(item.title ? [[item.title, "schinese", "CN"] as [string, string, string]] : []),
    ...english.slice(0, 2).map((name): [string, string, string] => [name, "english", "US"]),
  ];
  for (const [term, language, country] of searches) {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=${language}&cc=${country}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) continue;
    const { items = [] } = (await res.json()) as { items?: SteamHit[] };
    const hit = items.find((i) => i.type === "app" && wanted.includes(normalizeName(i.name)));
    if (!hit) continue;
    for (const file of ["library_hero.jpg", "header.jpg"]) {
      const image = `https://cdn.cloudflare.steamstatic.com/steam/apps/${hit.id}/${file}`;
      const head = await fetch(image, { method: "HEAD" });
      if (head.ok) return image;
    }
  }
  return null;
}

type GridGame = { id: number; name: string; release_date?: number };
type GridHero = { url: string; style: string; score?: number };

async function steamGrid<T>(path: string) {
  const key = env.STEAMGRIDDB_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://www.steamgriddb.com/api/v2/${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const body = (await res.json()) as { success?: boolean; data?: T };
  return body.success ? (body.data ?? null) : null;
}

async function steamGridHero(item: DetailsItem, english: string[]) {
  for (const name of english.slice(0, 2)) {
    const wanted = normalizeName(name);
    const games = await steamGrid<GridGame[]>(`search/autocomplete/${encodeURIComponent(name)}`);
    // Same name, or ours plus an edition word ("Pokémon FireRed" → "Pokémon FireRed Version");
    // a matching release year breaks ties between remakes.
    const year = (game: GridGame) => (game.release_date ? new Date(game.release_date * 1000).getUTCFullYear() : null);
    const candidates = (games ?? []).filter((game) => {
      const found = normalizeName(game.name);
      return found === wanted || (wanted.length >= 6 && found.startsWith(wanted));
    });
    const game = candidates.find((g) => item.year && year(g) === item.year) ?? candidates[0];
    if (!game) continue;
    // Heroes are wide banners without the title logo, made for a library's header. The
    // "alternate" style is the game's own art; "material" is flat abstract design and
    // "blurred" a blur, so those only stand in when nothing else exists. Most voted first.
    for (const styles of ["alternate", "material"]) {
      const heroes = await steamGrid<GridHero[]>(
        `heroes/game/${game.id}?styles=${styles}&dimensions=1920x620,3840x1240&types=static&nsfw=false&humor=false&epilepsy=false`,
      );
      const hero = heroes?.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
      if (hero) return hero.url;
    }
  }
  return null;
}
