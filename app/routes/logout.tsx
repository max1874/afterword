import { redirect } from "react-router";

import type { Route } from "./+types/logout";
import { logOut } from "~/lib/session.server";

export async function action({ request }: Route.ActionArgs) {
  return logOut(request);
}

export function loader() {
  return redirect("/");
}
