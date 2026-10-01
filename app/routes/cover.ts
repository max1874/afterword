import { env } from "cloudflare:workers";

import type { Route } from "./+types/cover";

export async function loader({ params }: Route.LoaderArgs) {
  const object = await env.COVERS.get(`covers/${params.key}`);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      // Keys are random and never reused, so the image can be cached forever.
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: object.httpEtag,
    },
  });
}
