import { env } from "cloudflare:workers";

import type { Route } from "./+types/api.v1";
import {
  createInvite,
  deleteOtherSessions,
  deletePasskey,
  deleteSession,
  findUserByHandle,
  listInvites,
  listPasskeys,
  listSessions,
  recoveryCodeStatements,
  revokeInvite,
  saveProfile,
  spendRecoveryCode,
  unusedRecoveryCodes,
} from "~/lib/accounts.server";
import { addManualItem, parseMark, pickItem } from "~/lib/catalog.server";
import {
  countByKindAndStatus,
  countByYear,
  deleteMark,
  getItem,
  listMarked,
  markedSourceIds,
  saveMark,
  today,
  type Item,
} from "~/lib/db.server";
import { coverSrc, previewSrc } from "~/lib/format";
import { IMPORT_BATCH_SIZE, importRows } from "~/lib/import.server";
import { isKind, isStatus } from "~/lib/kinds";
import { searchAll } from "~/lib/providers.server";
import { endSession, getViewer, sameOrigin, startSession, type Viewer } from "~/lib/session.server";

/**
 * JSON API for the iOS app, mirroring what the web pages can do. The app
 * authenticates with `Authorization: Bearer <token>` from a passkey sign-in at
 * /auth/passkey (with `client: "app"`) or from `POST auth/recovery`.
 * Cover paths are relative to the site, like on the web.
 */

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function viewerOrThrow(request: Request) {
  const viewer = await getViewer(request);
  if (!viewer) throw new ApiError(401, "请先登录");
  return viewer;
}

async function userOrThrow(handle: string) {
  const user = await findUserByHandle(handle.replace(/^@/, "").toLowerCase());
  if (!user) throw new ApiError(404, "没有这个用户");
  return user;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "请求体需要是 JSON 对象");
  return value as Record<string, unknown>;
}

/** `{ get }` over a JSON object, so the same validators serve forms and JSON. */
function fields(value: Record<string, unknown>) {
  return { get: (name: string) => value[name] ?? null };
}

function withCover<T extends Pick<Item, "cover_key" | "cover_url">>(item: T) {
  return { ...item, cover: coverSrc(item) };
}

type Handler = (args: { request: Request; params: string[]; url: URL }) => Promise<Response>;

const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];

function on(method: string, path: string, handler: Handler) {
  // `:name` matches one segment; captured in order.
  const pattern = new RegExp(`^${path.replace(/:[a-z]+/g, "([^/]+)")}$`);
  routes.push({ method, pattern, handler });
}

// Session

on("GET", "me", async ({ request }) => {
  const viewer = await viewerOrThrow(request);
  return json({ id: viewer.id, handle: viewer.handle, name: viewer.name, isAdmin: Boolean(viewer.is_admin), today: today() });
});

on("POST", "auth/recovery", async ({ request }) => {
  const input = await body(request);
  const handle = String(input.handle ?? "").trim().replace(/^@/, "").toLowerCase();
  const user = handle ? await findUserByHandle(handle) : null;
  if (!user || !(await spendRecoveryCode(user.id, String(input.code ?? "")))) {
    throw new ApiError(401, "用户名或恢复码不对，或者这个恢复码已经用过了");
  }
  const session = await startSession(request, user.id);
  return json({ token: session.token, handle: user.handle });
});

on("POST", "auth/logout", async ({ request }) => {
  await endSession(request);
  return json({ ok: true });
});

// Profiles and marks

on("GET", "users/:handle", async ({ params }) => {
  const user = await userOrThrow(params[0]);
  return json({ handle: user.handle, name: user.name, counts: await countByKindAndStatus(user.id) });
});

on("GET", "users/:handle/marks", async ({ params, url }) => {
  const user = await userOrThrow(params[0]);
  const kindParam = url.searchParams.get("kind");
  const statusParam = url.searchParams.get("status");
  const kind = isKind(kindParam) ? kindParam : undefined;
  const status = isStatus(statusParam) ? statusParam : undefined;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const [{ items, hasMore }, yearCounts] = await Promise.all([
    listMarked({ userId: user.id, kind, status, page }),
    countByYear({ userId: user.id, kind, status }),
  ]);
  return json({ page, hasMore, yearCounts, items: items.map(withCover) });
});

on("GET", "users/:handle/items/:id", async ({ request, params }) => {
  const user = await userOrThrow(params[0]);
  const viewer = await getViewer(request);
  const mine = viewer?.id === user.id;
  const item = await getItem(params[1], user.id);
  if (!item || (!mine && !item.status)) throw new ApiError(404, "没有这条标记");
  return json({ mine, item: withCover(item) });
});

on("PUT", "marks/:id", async ({ request, params }) => {
  const viewer = await viewerOrThrow(request);
  const parsed = parseMark(fields(await body(request)));
  if ("error" in parsed) throw new ApiError(400, parsed.error);
  if (!(await getItem(params[0], viewer.id))) throw new ApiError(404, "没有这个条目");
  await saveMark(viewer.id, params[0], parsed.mark);
  return json({ item: withCover((await getItem(params[0], viewer.id))!) });
});

on("DELETE", "marks/:id", async ({ request, params }) => {
  const viewer = await viewerOrThrow(request);
  await deleteMark(viewer.id, params[0]);
  return json({ ok: true });
});

// Adding works

on("GET", "search", async ({ request, url }) => {
  const viewer = await viewerOrThrow(request);
  const kind = url.searchParams.get("kind");
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!isKind(kind)) throw new ApiError(400, "类型无效");
  if (!query) return json({ groups: [] });
  const groups = await searchAll(kind, query);
  return json({
    groups: await Promise.all(
      groups.map(async (group) => {
        const marked = await markedSourceIds(viewer.id, group.source, group.items.map((i) => i.source_id!));
        return {
          ...group,
          items: group.items.map((item) => ({
            ...item,
            cover: previewSrc(item.cover_url),
            existingId: marked.get(item.source_id!) ?? null,
          })),
        };
      }),
    ),
  });
});

on("POST", "items/pick", async ({ request }) => {
  const viewer = await viewerOrThrow(request);
  const input = await body(request);
  if (!isKind(input.kind)) throw new ApiError(400, "类型无效");
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const result = await pickItem(viewer.id, input.kind, str(input.source), str(input.source_id), str(input.q));
  if ("error" in result) throw new ApiError(400, result.error);
  return json(result);
});

on("POST", "items", async ({ request }) => {
  const viewer = await viewerOrThrow(request);
  const result = await addManualItem(viewer.id, fields(await body(request)));
  if ("error" in result) throw new ApiError(400, result.error);
  return json(result);
});

on("POST", "import", async ({ request }) => {
  const viewer = await viewerOrThrow(request);
  const rows = await request.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length > IMPORT_BATCH_SIZE) {
    throw new ApiError(400, `每批需要是不超过 ${IMPORT_BATCH_SIZE} 条的数组`);
  }
  return json(await importRows(viewer.id, Boolean(viewer.is_admin), rows));
});

// Settings

async function settings(request: Request, viewer: Viewer) {
  const [passkeys, sessions, recoveryLeft, invites] = await Promise.all([
    listPasskeys(viewer.id),
    listSessions(viewer.id),
    unusedRecoveryCodes(viewer.id),
    viewer.is_admin ? listInvites(viewer.id) : Promise.resolve(null),
  ]);
  const origin = new URL(request.url).origin;
  return {
    passkeys,
    sessions: sessions.map((s) => ({ ...s, current: s.id === viewer.session_id })),
    recoveryLeft,
    invites: invites?.map((invite) => ({ ...invite, url: `${origin}/join/${invite.code}` })) ?? null,
  };
}

on("GET", "settings", async ({ request }) => json(await settings(request, await viewerOrThrow(request))));

on("PATCH", "profile", async ({ request }) => {
  const viewer = await viewerOrThrow(request);
  const result = await saveProfile(viewer.id, fields(await body(request)));
  if ("error" in result) throw new ApiError(400, result.error);
  return json(result.saved);
});

on("DELETE", "passkeys/:id", async ({ request, params }) => {
  const viewer = await viewerOrThrow(request);
  if (!(await deletePasskey(viewer.id, decodeURIComponent(params[0])))) throw new ApiError(400, "至少要留一个通行密钥");
  return json({ remaining: (await listPasskeys(viewer.id)).map((p) => p.id) });
});

on("DELETE", "sessions/:id", async ({ request, params }) => {
  const viewer = await viewerOrThrow(request);
  await deleteSession(viewer.id, params[0]);
  return json({ ok: true });
});

on("POST", "sessions/sign-out-others", async ({ request }) => {
  const viewer = await viewerOrThrow(request);
  await deleteOtherSessions(viewer.id, viewer.session_id);
  return json({ ok: true });
});

on("POST", "recovery-codes", async ({ request }) => {
  const viewer = await viewerOrThrow(request);
  const { codes, statements } = await recoveryCodeStatements(viewer.id);
  await env.DB.batch(statements);
  return json({ codes });
});

on("POST", "invites", async ({ request }) => {
  const viewer = await viewerOrThrow(request);
  if (!viewer.is_admin) throw new ApiError(403, "只有管理员可以邀请");
  const code = await createInvite(viewer.id);
  return json({ code, url: `${new URL(request.url).origin}/join/${code}` });
});

on("DELETE", "invites/:code", async ({ request, params }) => {
  const viewer = await viewerOrThrow(request);
  if (!viewer.is_admin) throw new ApiError(403, "只有管理员可以邀请");
  await revokeInvite(viewer.id, params[0]);
  return json({ ok: true });
});

async function handle(request: Request, splat: string) {
  // Cookies also authenticate here, so cross-site browser requests are refused.
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "Forbidden" }, 403);
  const url = new URL(request.url);
  for (const route of routes) {
    const match = splat.match(route.pattern);
    if (!match) continue;
    if (route.method !== request.method) continue;
    try {
      return await route.handler({ request, params: match.slice(1), url });
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      throw error;
    }
  }
  const pathExists = routes.some((route) => route.pattern.test(splat));
  return json({ error: pathExists ? "Method not allowed" : "Not found" }, pathExists ? 405 : 404);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return handle(request, params["*"] ?? "");
}

export async function action({ request, params }: Route.ActionArgs) {
  return handle(request, params["*"] ?? "");
}
