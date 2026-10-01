import { env } from "cloudflare:workers";
import { createCookieSessionStorage, redirect } from "react-router";

type SessionData = { owner: true };

let storage: ReturnType<typeof createCookieSessionStorage<SessionData>> | undefined;

function sessionStorage() {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
  storage ??= createCookieSessionStorage<SessionData>({
    cookie: {
      name: "afterword_session",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: !import.meta.env.DEV,
      secrets: [env.SESSION_SECRET],
      maxAge: 60 * 60 * 24 * 90,
    },
  });
  return storage;
}

export async function isOwner(request: Request) {
  const session = await sessionStorage().getSession(request.headers.get("Cookie"));
  return session.get("owner") === true;
}

/** Throws a redirect to the login page unless the request comes from the owner. */
export async function requireOwner(request: Request) {
  if (await isOwner(request)) return;
  const url = new URL(request.url);
  throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
}

export async function checkPassword(password: string) {
  const expected = env.OWNER_PASSWORD;
  if (!expected) throw new Error("OWNER_PASSWORD is not set");
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(password)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function logIn(request: Request, next: string) {
  const store = sessionStorage();
  const session = await store.getSession(request.headers.get("Cookie"));
  session.set("owner", true);
  return redirect(next, { headers: { "Set-Cookie": await store.commitSession(session) } });
}

export async function logOut(request: Request) {
  const store = sessionStorage();
  const session = await store.getSession(request.headers.get("Cookie"));
  return redirect("/", { headers: { "Set-Cookie": await store.destroySession(session) } });
}
