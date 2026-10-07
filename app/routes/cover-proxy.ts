import type { Route } from "./+types/cover-proxy";
import { coverHeaders } from "~/lib/covers.server";
import { isDoubanImage } from "~/lib/providers.server";
import { getViewer } from "~/lib/session.server";

/**
 * Search-result thumbnails from Douban, whose image hosts refuse browsers
 * that are not on douban.com. Signed-in only and limited to Douban hosts so it is
 * not an open proxy; marked items use the R2 copy instead.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url).searchParams.get("url") ?? "";
  if (!isDoubanImage(url) || !(await getViewer(request))) return new Response("Not found", { status: 404 });
  const res = await fetch(url, { headers: coverHeaders(url) });
  const type = res.headers.get("Content-Type") ?? "";
  if (!res.ok || !type.startsWith("image/")) return new Response("Bad gateway", { status: 502 });
  return new Response(res.body, {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" },
  });
}
