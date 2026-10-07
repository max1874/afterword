import { env } from "cloudflare:workers";

import { DOUBAN_HEADERS, isDoubanImage, USER_AGENT } from "./providers.server";

const MAX_COVER_BYTES = 5 * 1024 * 1024;

export function coverHeaders(url: string): HeadersInit {
  return isDoubanImage(url) ? DOUBAN_HEADERS : { "User-Agent": USER_AGENT };
}

/**
 * Copies a remote cover into R2 so the page no longer depends on the source
 * site. Returns null when the image cannot be fetched; callers then fall back
 * to the remote URL.
 */
export async function storeCover(url: string | null) {
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: coverHeaders(url) });
    const type = res.headers.get("Content-Type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_COVER_BYTES) return null;
    const key = `covers/${crypto.randomUUID()}`;
    await env.COVERS.put(key, body, { httpMetadata: { contentType: type } });
    return key;
  } catch (error) {
    console.warn("cover fetch failed", url, error);
    return null;
  }
}
