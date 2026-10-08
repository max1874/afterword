import { env, waitUntil } from "cloudflare:workers";

import { storeCover } from "./covers.server";
import type { Item } from "./db.server";
import { clip, DOUBAN_MOBILE_HEADERS, USER_AGENT } from "./providers.server";

/**
 * What a Douban import leaves out, looked up once per item in the background:
 * the summary and a few facts from Douban's own app API, and landscape artwork
 * for the wide cards (TMDB backdrops for films and series; Steam, IGDB or
 * SteamGridDB art for games), copied into R2 like covers. The owner can replace
 * a poor automatic pick with any of `artworkChoices`.
 */

type DetailsItem = Pick<
  Item,
  "id" | "kind" | "title" | "original_title" | "year" | "source" | "source_id" | "summary"
> & {
  backdrop_key?: string | null;
  facts?: string | null;
  details_checked_at?: string | null;
};

/**
 * Items looked up per request, to stay inside the Workers subrequest limit: a game
 * that no source knows costs about a dozen requests across Douban, Steam, IGDB and SteamGridDB.
 */
const PER_REQUEST = 3;

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
  if (item.backdrop_key || !hasArtwork(item)) return;
  const url = item.kind === "screen" ? await tmdbBackdrop(item) : await gameArt(item, await douban().catch(() => null));
  if (!url) return;
  const key = await storeCover(url);
  await env.DB.prepare("UPDATE items SET backdrop_url = ?, backdrop_key = ? WHERE id = ?").bind(url, key, item.id).run();
}

/** Only films, series and games have landscape artwork to look up or choose from. */
export const hasArtwork = (item: Pick<Item, "kind">) => item.kind === "screen" || item.kind === "game";

/** One image offered by 更换横图: `url` is what gets stored, `thumb` a smaller copy to show. */
export type ArtworkChoice = { url: string; thumb: string; source: string };

/**
 * Every landscape image the sources have for an item, best first, for choosing
 * by hand when the automatic pick is poor.
 */
export async function artworkChoices(item: DetailsItem): Promise<ArtworkChoice[]> {
  if (!hasArtwork(item)) return [];
  const settled = await Promise.allSettled(
    item.kind === "screen"
      ? [tmdbChoices(item)]
      : [
          doubanSubject(item)
            .catch(() => null)
            .then((subject) => {
              const english = englishNames(item, subject);
              return Promise.allSettled([steamChoices(item, english), igdbChoices(item, english), steamGridChoices(item, english)]);
            })
            .then((lists) => lists.flatMap((list) => (list.status === "fulfilled" ? list.value : []))),
        ],
  );
  const choices = settled.flatMap((list) => (list.status === "fulfilled" ? list.value : []));
  return choices.filter((choice, i) => choices.findIndex((c) => c.url === choice.url) === i);
}

/** Hosts a chosen image may come from, so the choice cannot fetch anything else into R2. */
const ARTWORK_HOSTS = [/\.tmdb\.org$/, /\.steamstatic\.com$/, /^images\.igdb\.com$/, /\.steamgriddb\.com$/];

/** Stores the chosen image as the item's artwork, or with null shows the cover instead. */
export async function chooseArtwork(item: DetailsItem, url: string | null) {
  let key: string | null = null;
  if (url) {
    const host = URL.canParse(url) ? new URL(url) : null;
    if (host?.protocol !== "https:" || !ARTWORK_HOSTS.some((h) => h.test(host.hostname))) return { error: "图片来源不对" };
    key = await storeCover(url);
    if (!key) return { error: "这张图下载失败了，换一张试试" };
  }
  // Marking the item looked up keeps the background lookup from replacing the choice.
  await env.DB.prepare(
    "UPDATE items SET backdrop_url = ?, backdrop_key = ?, details_checked_at = COALESCE(details_checked_at, datetime('now')) WHERE id = ?",
  )
    .bind(url, key, item.id)
    .run();
  if (item.backdrop_key) await env.COVERS.delete(item.backdrop_key);
  return { ok: true };
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

const tmdbImage = (path: string, size = "w1280") => `https://image.tmdb.org/t/p/${size}${path}`;

/** The film or series on TMDB ("movie/603", "tv/1399"), its backdrop, and the season when the title names one. */
type TmdbFound = { path: string; backdrop: string | null; season?: number };

async function tmdbBackdrop(item: DetailsItem) {
  const found = await tmdbFind(item);
  return found?.backdrop ? tmdbImage(found.backdrop) : null;
}

async function tmdbFind(item: DetailsItem): Promise<TmdbFound | null> {
  // Items picked from TMDB know their id.
  if (item.source === "tmdb" && item.source_id) {
    const hit = await tmdb<TmdbHit>(item.source_id, {});
    return hit ? { path: item.source_id, backdrop: hit.backdrop_path ?? null } : null;
  }
  const wanted = names(item);
  if (!wanted.length) return null;
  const queries = [...new Set([item.original_title, item.title].filter((q): q is string => Boolean(q)).map(seriesName))];
  let best: { hit: TmdbHit; path: string; score: number } | null = null;
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
    const hits = [
      ...(movies?.results ?? []).map((hit) => ({ hit, path: `movie/${hit.id}` })),
      ...(series?.results ?? []).map((hit) => ({ hit, path: `tv/${hit.id}` })),
    ];
    for (const { hit, path } of hits) {
      if (!hit.backdrop_path) continue;
      const hitNames = [hit.title, hit.name, hit.original_title, hit.original_name].map(normalizeName);
      if (!hitNames.some((n) => n && wanted.includes(n))) continue;
      const year = Number((hit.release_date ?? hit.first_air_date ?? "").slice(0, 4));
      // Same name is required; a matching or earlier first year breaks ties between remakes.
      const score = !item.year || !year ? 1 : year === item.year ? 3 : year < item.year ? 2 : 0;
      if (!best || score > best.score) best = { hit, path, score };
    }
    if (best && best.score >= 2) break;
  }
  if (best) return { path: best.path, backdrop: best.hit.backdrop_path ?? null };
  for (const { hit, rest } of partial) {
    const season = await seasonNamed(hit.id, rest);
    const stills = season ? await seasonStills(hit.id, season) : [];
    if (stills.length) return { path: `tv/${hit.id}`, backdrop: stills[0], season };
  }
  return null;
}

/** The season's episode stills, then the backdrops TMDB's voters rate highest. */
async function tmdbChoices(item: DetailsItem): Promise<ArtworkChoice[]> {
  const found = await tmdbFind(item);
  if (!found) return [];
  const [stills, images] = await Promise.all([
    found.season ? seasonStills(found.path.split("/")[1], found.season) : [],
    tmdb<{ backdrops?: { file_path: string; vote_average?: number }[] }>(`${found.path}/images`, {
      include_image_language: "null,zh,en,ja",
    }),
  ]);
  const backdrops = (images?.backdrops ?? []).sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0)).map((b) => b.file_path);
  return [...new Set([...stills.slice(0, 8), ...(found.backdrop ? [found.backdrop] : []), ...backdrops.slice(0, 16)])].map((path) => ({
    url: tmdbImage(path),
    thumb: tmdbImage(path, "w780"),
    source: "TMDB",
  }));
}

type TmdbSeason = { season_number: number; name: string };

/**
 * The number of the season named like `rest` ("飙马野郎" → "飙马野郎篇"). Seasons have
 * posters but no backdrops on TMDB, and the series backdrop would show another part,
 * so such items use a still from the season's first episode.
 */
async function seasonNamed(seriesId: number, rest: string) {
  const series = await tmdb<{ seasons?: TmdbSeason[] }>(`tv/${seriesId}`, {});
  return series?.seasons?.find((s) => {
    const name = normalizeName(s.name).replace(/[篇章]$/, "");
    return s.season_number > 0 && name.length >= 2 && (rest.includes(name) || name.includes(rest));
  })?.season_number;
}

/** Episode still paths of a season, in episode order. */
async function seasonStills(seriesId: number | string, season: number) {
  const detail = await tmdb<{ episodes?: { still_path?: string | null }[] }>(`tv/${seriesId}/season/${season}`, {});
  return (detail?.episodes ?? []).map((e) => e.still_path).filter((p): p is string => Boolean(p));
}

// Games: Steam's own library hero first, then IGDB's official key art, which covers
// Nintendo and PlayStation games, then SteamGridDB's community heroes. All are searched
// by the English name, which Douban keeps as the original title or among the aliases of
// Japanese games.

/** English (Latin-script) names of a game, from its original title and Douban aliases. */
function englishNames(item: DetailsItem, subject: DoubanSubject | null) {
  const names = [item.original_title, ...(subject?.aliases ?? [])].filter(
    (name): name is string => Boolean(name) && /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u.test(name!) && name!.length > 3,
  );
  return [...new Set(names)].slice(0, 3);
}

async function gameArt(item: DetailsItem, subject: DoubanSubject | null) {
  const english = englishNames(item, subject);
  return (await steamHero(item, english)) ?? (await igdbArt(item, english)) ?? (await steamGridHero(item, english));
}

/**
 * The game among `games` with our name, or ours plus an edition word ("Pokémon FireRed"
 * → "Pokémon FireRed Version"); a matching release year breaks ties between remakes.
 */
function sameGame<T>(item: DetailsItem, wanted: string, games: T[], name: (game: T) => string, year: (game: T) => number | null) {
  const candidates = games.filter((game) => {
    const found = normalizeName(name(game));
    return found === wanted || (wanted.length >= 6 && found.startsWith(wanted));
  });
  return candidates.find((game) => item.year && year(game) === item.year) ?? candidates[0] ?? null;
}

const yearOf = (seconds?: number) => (seconds ? new Date(seconds * 1000).getUTCFullYear() : null);

type SteamHit = { type: string; name: string; id: number };

async function steamApp(item: DetailsItem, english: string[]) {
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
    if (hit) return hit.id;
  }
  return null;
}

const steamImage = (app: number, file: string) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${app}/${file}`;

async function steamHero(item: DetailsItem, english: string[]) {
  const app = await steamApp(item, english);
  if (!app) return null;
  for (const file of ["library_hero.jpg", "header.jpg"]) {
    const image = steamImage(app, file);
    const head = await fetch(image, { method: "HEAD" });
    if (head.ok) return image;
  }
  return null;
}

/** The library hero, then the store page's screenshots. */
async function steamChoices(item: DetailsItem, english: string[]): Promise<ArtworkChoice[]> {
  const app = await steamApp(item, english);
  if (!app) return [];
  const [hero, details] = await Promise.all([
    fetch(steamImage(app, "library_hero.jpg"), { method: "HEAD" }),
    fetch(`https://store.steampowered.com/api/appdetails?appids=${app}&filters=screenshots`, {
      headers: { "User-Agent": USER_AGENT },
    }).then((res) => (res.ok ? res.json() : null)) as Promise<Record<string, { data?: { screenshots?: { path_thumbnail: string; path_full: string }[] } }> | null>,
  ]);
  const shots = details?.[app]?.data?.screenshots ?? [];
  return [
    ...(hero.ok ? [{ url: steamImage(app, "library_hero.jpg"), thumb: steamImage(app, "library_hero.jpg"), source: "Steam" }] : []),
    ...shots.slice(0, 8).map((s) => ({ url: s.path_full, thumb: s.path_thumbnail, source: "Steam" })),
  ];
}

// IGDB, through a Twitch app's client credentials.

type IgdbImage = { image_id: string; width?: number; height?: number; artwork_type?: number };
type IgdbGame = { name: string; first_release_date?: number; artworks?: IgdbImage[]; screenshots?: IgdbImage[] };

/**
 * Shared by lookups in the same isolate, including ones running side by side; Twitch
 * tokens last about two months. A failed request is tried again after a minute.
 */
let igdbToken: { value: Promise<string | null>; expires: number } | null = null;

function igdbAuth(id: string, secret: string) {
  if (!igdbToken || igdbToken.expires < Date.now()) {
    const entry = { value: Promise.resolve<string | null>(null), expires: Date.now() + 60_000 };
    const params = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" });
    entry.value = fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: "POST" }).then(async (res) => {
      if (!res.ok) return null;
      const token = (await res.json()) as { access_token: string; expires_in: number };
      entry.expires = Date.now() + (token.expires_in - 3600) * 1000;
      return token.access_token;
    });
    igdbToken = entry;
  }
  return igdbToken.value;
}

async function igdb<T>(endpoint: string, query: string) {
  const id = env.TWITCH_CLIENT_ID;
  const secret = env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) return null;
  const token = await igdbAuth(id, secret).catch(() => null);
  if (!token) return null;
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: { "Client-ID": id, Authorization: `Bearer ${token}` },
    body: query,
  });
  return res.ok ? ((await res.json()) as T) : null;
}

async function igdbGame(item: DetailsItem, english: string[]) {
  for (const name of english.slice(0, 2)) {
    // Editions ("25th Anniversary Edition") point at the game as their version parent.
    const games = await igdb<IgdbGame[]>(
      "games",
      `search "${name.replace(/["\\]/g, "")}"; where version_parent = null; limit 10;
       fields name, first_release_date, artworks.image_id, artworks.width, artworks.height, artworks.artwork_type,
         screenshots.image_id, screenshots.width, screenshots.height;`,
    );
    const game = sameGame(item, normalizeName(name), games ?? [], (g) => g.name, (g) => yearOf(g.first_release_date));
    if (game) return game;
  }
  return null;
}

const igdbImage = (image: IgdbImage, size = "t_1080p") => `https://images.igdb.com/igdb/image/upload/${size}/${image.image_id}.jpg`;

const landscape = (image: IgdbImage) => Boolean(image.width && image.height && image.width / image.height >= 1.3 && image.width / image.height <= 2.6);

/**
 * IGDB artwork types, best for a wide card first: key art without the logo, plain artwork,
 * historical artwork, then key art with the logo. Logos, covers, icons and concept art are left out.
 */
const ARTWORK_TYPES = [2, 1, 15, 3];

function igdbArtworks(game: IgdbGame) {
  const rank = (image: IgdbImage) => ARTWORK_TYPES.indexOf(image.artwork_type ?? 1);
  return (game.artworks ?? [])
    .filter((image) => landscape(image) && rank(image) >= 0)
    .sort((a, b) => rank(a) - rank(b) || b.width! * b.height! - a.width! * a.height!);
}

async function igdbArt(item: DetailsItem, english: string[]) {
  const game = await igdbGame(item, english);
  const art = game && igdbArtworks(game)[0];
  return art ? igdbImage(art) : null;
}

async function igdbChoices(item: DetailsItem, english: string[]): Promise<ArtworkChoice[]> {
  const game = await igdbGame(item, english);
  if (!game) return [];
  return [...igdbArtworks(game), ...(game.screenshots ?? []).filter(landscape).slice(0, 8)].map((image) => ({
    url: igdbImage(image),
    thumb: igdbImage(image, "t_screenshot_med"),
    source: "IGDB",
  }));
}

// SteamGridDB

type GridGame = { id: number; name: string; release_date?: number };
type GridHero = { url: string; thumb: string; style: string; score?: number };

async function steamGrid<T>(path: string) {
  const key = env.STEAMGRIDDB_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://www.steamgriddb.com/api/v2/${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const body = (await res.json()) as { success?: boolean; data?: T };
  return body.success ? (body.data ?? null) : null;
}

async function steamGridGame(item: DetailsItem, english: string[]) {
  for (const name of english.slice(0, 2)) {
    const games = await steamGrid<GridGame[]>(`search/autocomplete/${encodeURIComponent(name)}`);
    const game = sameGame(item, normalizeName(name), games ?? [], (g) => g.name, (g) => yearOf(g.release_date));
    if (game) return game;
  }
  return null;
}

/** Most voted first. */
async function steamGridHeroes(gameId: number, styles: string) {
  const heroes = await steamGrid<GridHero[]>(
    `heroes/game/${gameId}?styles=${styles}&dimensions=1920x620,3840x1240&types=static&nsfw=false&humor=false&epilepsy=false`,
  );
  return (heroes ?? []).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

async function steamGridHero(item: DetailsItem, english: string[]) {
  const game = await steamGridGame(item, english);
  if (!game) return null;
  // Heroes are wide banners without the title logo, made for a library's header. The
  // "alternate" style is the game's own art; "material" is flat abstract design and
  // "blurred" a blur, so those only stand in when nothing else exists.
  for (const styles of ["alternate", "material"]) {
    const hero = (await steamGridHeroes(game.id, styles))[0];
    if (hero) return hero.url;
  }
  return null;
}

async function steamGridChoices(item: DetailsItem, english: string[]): Promise<ArtworkChoice[]> {
  const game = await steamGridGame(item, english);
  if (!game) return [];
  return (await steamGridHeroes(game.id, "alternate")).slice(0, 12).map((hero) => ({
    url: hero.url,
    thumb: hero.thumb,
    source: "SteamGridDB",
  }));
}
