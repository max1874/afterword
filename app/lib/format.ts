/** Cover image URL: the R2 copy when stored, otherwise the source site's. */
export function coverSrc(item: { cover_key: string | null; cover_url: string | null }) {
  if (item.cover_key) return `/${item.cover_key}`;
  return item.cover_url;
}

/** Same-origin path to return to after login; anything else falls back to home. */
export function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
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
