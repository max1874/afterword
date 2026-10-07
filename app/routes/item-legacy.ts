import { data, redirect } from "react-router";

import type { Route } from "./+types/item-legacy";
import { firstAdmin } from "~/lib/accounts.server";
import { getViewer } from "~/lib/session.server";

/**
 * Item links from before accounts (`/items/:id`) were the owner's marks. They
 * open your own page for the item when signed in, otherwise the owner's.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = (await getViewer(request)) ?? (await firstAdmin());
  if (!user) throw data(null, { status: 404 });
  return redirect(`/@${user.handle}/items/${params.id}`);
}
