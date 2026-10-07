import { env } from "cloudflare:workers";

import type { NewItem } from "./db.server";
import type { Kind } from "./kinds";

export const USER_AGENT = "afterword/0.1 (https://github.com/max1874/afterword)";

// Douban answers 418 to anything that does not look like a browser on douban.com,
// for both its pages and its image hosts.
export const DOUBAN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  Referer: "https://www.douban.com/",
};

export function isDoubanImage(url: string) {
  try {
    return new URL(url).hostname.endsWith(".doubanio.com");
  } catch {
    return false;
  }
}

export type SearchGroup = {
  source: string;
  label: string;
  items: NewItem[];
  error?: string;
};

type Provider = {
  source: string;
  label: string;
  kinds: Kind[];
  enabled: () => boolean;
  search: (kind: Kind, query: string) => Promise<NewItem[]>;
};

const SUMMARY_LIMIT = 2000;

function clip(text: string | null | undefined) {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.length > SUMMARY_LIMIT ? `${trimmed.slice(0, SUMMARY_LIMIT)}…` : trimmed;
}

function yearOf(date: string | null | undefined) {
  const year = Number(date?.slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : null;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json<T>();
}

// Bangumi: anime, real-world series, books, comics and games.
// https://bangumi.github.io/api/

type BangumiInfoValue = string | { k?: string; v: string }[];
type BangumiSubject = {
  id: number;
  type: number;
  name: string;
  name_cn: string;
  date: string | null;
  platform: string;
  summary: string;
  images: { common?: string; large?: string } | null;
  infobox?: { key: string; value: BangumiInfoValue }[];
};

const BANGUMI_TYPES: Record<Kind, number[]> = {
  screen: [2, 6],
  book: [1],
  comic: [1],
  game: [4],
};

const BANGUMI_CREATOR_KEYS: Record<Kind, string[]> = {
  screen: ["导演", "监督", "原作"],
  book: ["作者"],
  comic: ["作者", "原作", "作画"],
  game: ["开发", "发行"],
};

function bangumiCreators(subject: BangumiSubject, kind: Kind) {
  const names: string[] = [];
  for (const key of BANGUMI_CREATOR_KEYS[kind]) {
    const entry = subject.infobox?.find((e) => e.key === key);
    if (!entry) continue;
    const values = typeof entry.value === "string" ? [entry.value] : entry.value.map((v) => v.v);
    for (const v of values) if (v && !names.includes(v)) names.push(v);
    if (names.length) break;
  }
  return names.length ? names.slice(0, 3).join(" / ") : null;
}

const bangumi: Provider = {
  source: "bangumi",
  label: "Bangumi",
  kinds: ["screen", "book", "comic", "game"],
  enabled: () => true,
  async search(kind, query) {
    const data = await getJson<{ data: BangumiSubject[] }>(
      "https://api.bgm.tv/v0/search/subjects?limit=20",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: query, filter: { type: BANGUMI_TYPES[kind] } }),
      },
    );
    let subjects = data.data;
    if (kind === "comic") subjects = subjects.filter((s) => s.platform === "漫画");
    if (kind === "book") subjects = subjects.filter((s) => s.platform !== "漫画");
    return subjects.map((s) => ({
      kind,
      title: s.name_cn || s.name,
      original_title: s.name_cn && s.name_cn !== s.name ? s.name : null,
      year: yearOf(s.date),
      creators: bangumiCreators(s, kind),
      summary: clip(s.summary),
      cover_url: s.images?.common || s.images?.large || null,
      source: "bangumi",
      source_id: String(s.id),
      source_url: `https://bgm.tv/subject/${s.id}`,
    }));
  },
};

// Douban: films, series and books, through the search suggestion endpoint
// its own search box uses. Ids match Douban imports, so marked items show up.

type DoubanSuggestion = {
  id: string;
  type: string;
  title: string;
  url: string;
  year?: string;
  sub_title?: string;
  author_name?: string;
  img?: string;
  pic?: string;
};

const DOUBAN_SEARCH: Partial<Record<Kind, { host: string; type: string; prefix: string }>> = {
  screen: { host: "movie.douban.com", type: "movie", prefix: "movie" },
  book: { host: "book.douban.com", type: "b", prefix: "book" },
};

const douban: Provider = {
  source: "douban",
  label: "豆瓣",
  kinds: ["screen", "book"],
  enabled: () => true,
  async search(kind, query) {
    const target = DOUBAN_SEARCH[kind]!;
    const data = await getJson<DoubanSuggestion[]>(
      `https://${target.host}/j/subject_suggest?q=${encodeURIComponent(query)}`,
      { headers: DOUBAN_HEADERS },
    );
    return data
      .filter((s) => s.type === target.type)
      .map((s) => {
        const cover = (s.img ?? s.pic ?? "")
          .replace("/s_ratio_poster/", "/m_ratio_poster/")
          .replace("/view/subject/s/public/", "/view/subject/l/public/");
        return {
          kind,
          title: s.title,
          original_title: s.sub_title && s.sub_title !== s.title ? s.sub_title : null,
          year: yearOf(s.year),
          creators: s.author_name || null,
          summary: null,
          cover_url: cover || null,
          source: "douban",
          source_id: `${target.prefix}/${s.id}`,
          source_url: s.url,
        };
      });
  },
};

// TMDB: films and TV series. Needs an API key or v4 read access token.
// https://developer.themoviedb.org/reference/search-multi

type TmdbResult = {
  id: number;
  media_type: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
};

const tmdb: Provider = {
  source: "tmdb",
  label: "TMDB",
  kinds: ["screen"],
  enabled: () => Boolean(env.TMDB_API_KEY),
  async search(kind, query) {
    const key = env.TMDB_API_KEY!;
    const isToken = key.startsWith("eyJ");
    const url = new URL("https://api.themoviedb.org/3/search/multi");
    url.search = new URLSearchParams({ query, language: "zh-CN", include_adult: "false" }).toString();
    if (!isToken) url.searchParams.set("api_key", key);
    const data = await getJson<{ results: TmdbResult[] }>(url.toString(), {
      headers: isToken ? { Authorization: `Bearer ${key}` } : {},
    });
    return data.results
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .map((r) => {
        const title = r.title ?? r.name ?? "";
        const original = r.original_title ?? r.original_name ?? null;
        return {
          kind,
          title,
          original_title: original && original !== title ? original : null,
          year: yearOf(r.release_date ?? r.first_air_date),
          creators: null,
          summary: clip(r.overview),
          cover_url: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
          source: "tmdb",
          source_id: `${r.media_type}/${r.id}`,
          source_url: `https://www.themoviedb.org/${r.media_type}/${r.id}`,
        };
      });
  },
};

// Google Books: books. Needs an API key; the keyless quota is shared globally
// and usually exhausted. https://developers.google.com/books/docs/v1/using

type GoogleVolume = {
  id: string;
  volumeInfo: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publishedDate?: string;
    description?: string;
    imageLinks?: { thumbnail?: string };
  };
};

const googleBooks: Provider = {
  source: "googlebooks",
  label: "Google Books",
  kinds: ["book"],
  enabled: () => Boolean(env.GOOGLE_BOOKS_API_KEY),
  async search(kind, query) {
    const url = new URL("https://www.googleapis.com/books/v1/volumes");
    url.search = new URLSearchParams({
      q: query,
      maxResults: "20",
      printType: "books",
      key: env.GOOGLE_BOOKS_API_KEY!,
    }).toString();
    const data = await getJson<{ items?: GoogleVolume[] }>(url.toString());
    return (data.items ?? [])
      .filter((v) => v.volumeInfo.title)
      .map(({ id, volumeInfo: v }) => ({
        kind,
        title: v.subtitle ? `${v.title}：${v.subtitle}` : v.title!,
        original_title: null,
        year: yearOf(v.publishedDate),
        creators: v.authors?.slice(0, 3).join(" / ") ?? null,
        summary: clip(v.description),
        cover_url: v.imageLinks?.thumbnail?.replace(/^http:/, "https:") ?? null,
        source: "googlebooks",
        source_id: id,
        source_url: `https://books.google.com/books?id=${id}`,
      }));
  },
};

const PROVIDERS = [douban, tmdb, googleBooks, bangumi];

export async function searchAll(kind: Kind, query: string): Promise<SearchGroup[]> {
  const providers = PROVIDERS.filter((p) => p.kinds.includes(kind) && p.enabled());
  const settled = await Promise.allSettled(providers.map((p) => p.search(kind, query)));
  return providers.map((p, i) => {
    const result = settled[i];
    return result.status === "fulfilled"
      ? { source: p.source, label: p.label, items: result.value }
      : {
          source: p.source,
          label: p.label,
          items: [],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
  });
}
