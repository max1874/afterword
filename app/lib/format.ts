/** Cover image URL: the R2 copy when stored, otherwise the source site's. */
export function coverSrc(item: { cover_key: string | null; cover_url: string | null }) {
  if (item.cover_key) return `/${item.cover_key}`;
  return item.cover_url;
}

/** Landscape artwork URL, like `coverSrc`; null for items without any (books, comics, no match). */
export function backdropSrc(item: { backdrop_key?: string | null; backdrop_url?: string | null }) {
  if (item.backdrop_key) return `/${item.backdrop_key}`;
  return item.backdrop_url ?? null;
}

/** Search-result thumbnail; Douban images go through the signed-in proxy. */
export function previewSrc(url: string | null) {
  if (url && /^https:\/\/[^/]+\.doubanio\.com\//.test(url)) return `/cover-proxy?url=${encodeURIComponent(url)}`;
  return url;
}

const LOCAL = "http://local.invalid";

/**
 * Same-origin path to return to after login; anything else falls back to
 * home. Parsing catches tricks like `/\evil.com`, which browsers read as `//evil.com`.
 */
export function safeNext(value: string | null) {
  if (!value?.startsWith("/")) return "/";
  try {
    const url = new URL(value, LOCAL);
    return url.origin === LOCAL ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

const LATIN = /[A-Za-z0-9]/;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

/** Joins two strings, adding a space where Latin letters or digits meet Chinese or Japanese text. */
export function joinText(a: string, b: string) {
  const left = a.slice(-1);
  const right = b.charAt(0);
  const needsSpace = (LATIN.test(left) && CJK.test(right)) || (CJK.test(left) && LATIN.test(right));
  return needsSpace ? `${a} ${b}` : `${a}${b}`;
}

/** `2026-10-08` as 10月8日. */
export function monthDay(day: string) {
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
}
