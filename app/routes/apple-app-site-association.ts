import { env } from "cloudflare:workers";

/**
 * Lets the iOS app use this site's passkeys and open its links. `IOS_APP_ID`
 * is `<Team ID>.<bundle ID>`; without it the site has no app.
 */
export function loader() {
  const appID = env.IOS_APP_ID;
  if (!appID) return new Response(null, { status: 404 });
  return Response.json({
    webcredentials: { apps: [appID] },
    applinks: { details: [{ appIDs: [appID], components: [{ "/": "/@*" }] }] },
  });
}
