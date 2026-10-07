import { redirect } from "react-router";

import type { Route } from "./+types/setup";
import { AccountForm } from "~/components/account-form";
import { firstAdmin, passkeyCount } from "~/lib/accounts.server";

export function meta() {
  return [{ title: "初始设置 · 后记" }];
}

/** The owner's first sign-in: pick a handle and register a passkey, once. */
export async function loader() {
  const admin = await firstAdmin();
  if (!admin || (await passkeyCount(admin.id)) > 0) throw redirect("/login");
  return { handle: admin.handle === "owner" ? "" : admin.handle, name: admin.name === "owner" ? "" : admin.name };
}

export default function Setup({ loaderData }: Route.ComponentProps) {
  return (
    <section className="mx-auto mt-12 max-w-sm">
      <h1 className="text-2xl font-semibold">初始设置</h1>
      <p className="mt-2 mb-6 text-sm text-muted">
        你是这个后记的管理员，已有的标记都在你名下。用部署时的密码确认身份，然后创建通行密钥；之后就不再需要这个密码了。
      </p>
      <AccountForm kind="setup" initial={loaderData} submitLabel="创建通行密钥" />
    </section>
  );
}
