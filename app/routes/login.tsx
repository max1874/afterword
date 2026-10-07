import { browserSupportsWebAuthnAutofill } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { Link, redirect, useSearchParams } from "react-router";

import type { Route } from "./+types/login";
import { safeNext } from "~/lib/format";
import { cancelPending, passkeyMessage, signIn } from "~/lib/passkey";
import { getViewer } from "~/lib/session.server";

export function meta() {
  return [{ title: "登录 · 后记" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await getViewer(request);
  if (viewer) {
    const next = safeNext(new URL(request.url).searchParams.get("next"));
    throw redirect(next === "/" ? `/@${viewer.handle}` : next);
  }
  return null;
}

// A full load, so every loader (the header's too) sees the new session cookie.
function enter(path: string) {
  window.location.replace(path);
}

export default function Login() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Offer saved passkeys in the username field's autofill as soon as the page loads.
  useEffect(() => {
    let active = true;
    browserSupportsWebAuthnAutofill()
      .then((supported) => (supported ? signIn(next, true) : new Promise<never>(() => {})))
      .then((result) => active && enter(result.next))
      .catch((e) => active && setError(passkeyMessage(e)));
    return () => {
      active = false;
      cancelPending();
    };
  }, [next]);

  async function withButton() {
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(next);
      enter(result.next);
    } catch (e) {
      setError(passkeyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto mt-16 max-w-xs">
      <h1 className="text-2xl font-semibold">登录</h1>
      <p className="mt-2 text-sm text-muted">后记用通行密钥登录：Touch ID、Face ID，或者手机扫码。</p>
      <input
        type="text"
        name="username"
        autoComplete="username webauthn"
        placeholder="用户名"
        aria-label="用户名"
        className="mt-6 w-full"
      />
      <button
        type="button"
        onClick={withButton}
        disabled={busy}
        className="mt-3 w-full rounded-md bg-ink py-2 text-paper transition hover:opacity-85 disabled:opacity-60"
      >
        {busy ? "等待通行密钥…" : "用通行密钥登录"}
      </button>
      {error ? <p className="mt-3 text-sm text-seal">{error}</p> : null}
      <p className="mt-8 text-sm text-muted">
        设备丢了？
        <Link to={`/login/recovery?next=${encodeURIComponent(next)}`} className="ml-1 underline underline-offset-4 hover:text-ink">
          用恢复码登录
        </Link>
      </p>
    </section>
  );
}
