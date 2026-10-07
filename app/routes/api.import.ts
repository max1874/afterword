import type { Route } from "./+types/api.import";
import { IMPORT_BATCH_SIZE, importRows } from "~/lib/import.server";
import { getViewer } from "~/lib/session.server";

export async function action({ request }: Route.ActionArgs) {
  const viewer = await getViewer(request);
  if (!viewer) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body) || body.length > IMPORT_BATCH_SIZE) {
    return Response.json({ error: `每批需要是不超过 ${IMPORT_BATCH_SIZE} 条的数组` }, { status: 400 });
  }
  return Response.json(await importRows(viewer.id, Boolean(viewer.is_admin), body));
}
