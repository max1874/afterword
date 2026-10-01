/** Cover image URL: the R2 copy when stored, otherwise the source site's. */
export function coverSrc(item: { cover_key: string | null; cover_url: string | null }) {
  if (item.cover_key) return `/${item.cover_key}`;
  return item.cover_url;
}

/** Same-origin path to return to after login; anything else falls back to home. */
export function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
