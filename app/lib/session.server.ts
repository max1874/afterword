import { env } from "cloudflare:workers";
import { createCookie, createCookieSessionStorage, redirect } from "react-router";

export type Viewer = { id: string; handle: string; name: string; is_admin: number; session_id: string };

// Sessions slide: each day of use pushes expiry out again.
const SESSION_DAYS = 90;
const DAY_MS = 24 * 3600_000;

const sessionCookie = createCookie("afterword_sid", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: !import.meta.env.DEV,
  // The server decides when a session ends; the cookie only has to outlive it.
  maxAge: 400 * 24 * 3600,
});

export function sqlTime(ms: number) {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sessionToken(request: Request): Promise<string | null> {
  const value = await sessionCookie.parse(request.headers.get("Cookie"));
  return typeof value === "string" && value ? value : null;
}

async function loadViewer(request: Request): Promise<Viewer | null> {
  const token = await sessionToken(request);
  if (!token) return null;
  const sessionId = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.handle, u.name, u.is_admin, s.id AS session_id, s.last_seen_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now')`,
  )
    .bind(sessionId)
    .first<Viewer & { last_seen_at: string }>();
  if (!row) return null;
  const now = Date.now();
  if (now - Date.parse(`${row.last_seen_at.replace(" ", "T")}Z`) > DAY_MS) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
      .bind(sqlTime(now), sqlTime(now + SESSION_DAYS * DAY_MS), sessionId)
      .run();
  }
  const { last_seen_at: _, ...viewer } = row;
  return viewer;
}

const viewers = new WeakMap<Request, Promise<Viewer | null>>();

/** The signed-in person, or null. Cached per request since several loaders ask. */
export function getViewer(request: Request) {
  let viewer = viewers.get(request);
  if (!viewer) {
    viewer = loadViewer(request);
    viewers.set(request, viewer);
  }
  return viewer;
}

/** The signed-in person; otherwise throws a redirect to the login page. */
export async function requireViewer(request: Request) {
  const viewer = await getViewer(request);
  if (viewer) return viewer;
  const url = new URL(request.url);
  throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
}

/** Starts a session for the user and returns the Set-Cookie header value. */
export async function createSession(request: Request, userId: string) {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO sessions (id, user_id, user_agent, expires_at) VALUES (?, ?, ?, ?)")
    .bind(
      await sha256Hex(token),
      userId,
      request.headers.get("User-Agent")?.slice(0, 300) ?? null,
      sqlTime(Date.now() + SESSION_DAYS * DAY_MS),
    )
    .run();
  return sessionCookie.serialize(token);
}

export async function logOut(request: Request) {
  const token = await sessionToken(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  return redirect("/", { headers: { "Set-Cookie": await sessionCookie.serialize("", { maxAge: 0 }) } });
}

/**
 * What a WebAuthn ceremony is for, carried with its challenge in a short-lived
 * signed cookie from the options request to the verify request.
 */
export type Ceremony =
  | { purpose: "login"; challenge: string }
  | { purpose: "add"; challenge: string; userId: string }
  | { purpose: "setup" | "join"; challenge: string; userId: string; handle: string; name: string; invite?: string };

let ceremonies: ReturnType<typeof createCookieSessionStorage<{ ceremony: Ceremony }>> | undefined;

function ceremonyStorage() {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
  ceremonies ??= createCookieSessionStorage<{ ceremony: Ceremony }>({
    cookie: {
      name: "afterword_webauthn",
      httpOnly: true,
      sameSite: "strict",
      path: "/auth",
      secure: !import.meta.env.DEV,
      secrets: [env.SESSION_SECRET],
      maxAge: 600,
    },
  });
  return ceremonies;
}

export async function saveCeremony(ceremony: Ceremony) {
  const store = ceremonyStorage();
  const session = await store.getSession();
  session.set("ceremony", ceremony);
  return store.commitSession(session);
}

/** Reads and clears the pending ceremony; a challenge is good for one attempt. */
export async function takeCeremony(request: Request) {
  const store = ceremonyStorage();
  const session = await store.getSession(request.headers.get("Cookie"));
  return { ceremony: session.get("ceremony") ?? null, clear: await store.destroySession(session) };
}
