import type { Route } from "./+types/api.v1";
import { handleApi } from "~/lib/api.server";

// The router lives in a server module so the client build never sees it.
export async function loader({ request, params }: Route.LoaderArgs) {
  return handleApi(request, params["*"] ?? "");
}

export async function action({ request, params }: Route.ActionArgs) {
  return handleApi(request, params["*"] ?? "");
}
