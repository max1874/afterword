import { data, Form, redirect } from "react-router";

import type { Route } from "./+types/login";
import { safeNext } from "~/lib/format";
import { checkPassword, isOwner, logIn } from "~/lib/session.server";

export function meta() {
  return [{ title: "登录 · 后记" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await isOwner(request)) {
    throw redirect(safeNext(new URL(request.url).searchParams.get("next")));
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  if (!(await checkPassword(String(form.get("password") ?? "")))) {
    return data({ error: "密码不对" }, { status: 401 });
  }
  return logIn(request, next);
}

export default function Login({ actionData }: Route.ComponentProps) {
  return (
    <Form method="post" className="mx-auto mt-16 max-w-xs space-y-4">
      <h1 className="text-2xl font-semibold">登录</h1>
      <input
        type="password"
        name="password"
        placeholder="密码"
        autoComplete="current-password"
        autoFocus
        required
        className="w-full"
      />
      {actionData?.error ? <p className="text-sm text-seal">{actionData.error}</p> : null}
      <button className="w-full rounded-md bg-ink py-2 text-paper transition hover:opacity-85">登录</button>
    </Form>
  );
}
