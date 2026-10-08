import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/login.recovery";
import { findUserByHandle, spendRecoveryCode } from "~/lib/accounts.server";
import { createSession, sameOrigin } from "~/lib/session.server";

export function meta() {
  return [{ title: "用恢复码登录 · 后记" }];
}

export async function action({ request }: Route.ActionArgs) {
  if (!sameOrigin(request)) throw data(null, { status: 403 });
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "").trim().replace(/^@/, "").toLowerCase();
  const code = String(form.get("code") ?? "");
  const user = handle ? await findUserByHandle(handle) : null;
  // Same answer for an unknown user and a wrong code, so this does not reveal who has an account.
  if (!user || !(await spendRecoveryCode(user.id, code))) {
    return data({ error: "用户名或恢复码不对，或者这个恢复码已经用过了" }, { status: 401 });
  }
  return redirect("/settings?recovered=1", { headers: { "Set-Cookie": await createSession(request, user.id) } });
}

export default function RecoveryLogin({ actionData }: Route.ComponentProps) {
  return (
    <Form method="post" className="mx-auto mt-16 max-w-xs space-y-4">
      <h1 className="text-2xl font-semibold">用恢复码登录</h1>
      <p className="text-sm text-muted">每个恢复码只能用一次。登录后记得给新设备添加通行密钥。</p>
      <input name="handle" placeholder="用户名" autoComplete="username" required className="w-full" />
      <input
        name="code"
        placeholder="恢复码，如 k7m2q-9xd4a"
        autoComplete="one-time-code"
        required
        className="w-full font-mono"
      />
      {actionData?.error ? <p className="text-sm text-danger">{actionData.error}</p> : null}
      <button className="w-full rounded-md bg-ink py-2 text-paper transition hover:opacity-85">登录</button>
      <p className="text-sm">
        <Link to="/login" className="text-muted hover:text-ink">
          ← 用通行密钥登录
        </Link>
      </p>
    </Form>
  );
}
