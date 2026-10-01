import type { Route } from "./+types/api.import";
import { importRows } from "~/lib/import.server";
import { isOwner } from "~/lib/session.server";

// Matches the batch size the import page sends.
const IMPORT_BATCH_SIZE = 20;

export async function action({ request }: Route.ActionArgs) {
  if (!(await isOwner(request))) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body) || body.length > IMPORT_BATCH_SIZE) {
    return Response.json({ error: `每批需要是不超过 ${IMPORT_BATCH_SIZE} 条的数组` }, { status: 400 });
  }
  return Response.json(await importRows(body));
}
