import { Link } from "react-router";

import type { Route } from "./+types/join";
import { AccountForm } from "~/components/account-form";
import { openInvite } from "~/lib/accounts.server";
import { getViewer } from "~/lib/session.server";

export function meta() {
  return [{ title: "加入后记" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const [invite, viewer] = await Promise.all([openInvite(params.code), getViewer(request)]);
  return { valid: Boolean(invite), code: params.code, signedInAs: viewer?.handle ?? null };
}

export default function Join({ loaderData }: Route.ComponentProps) {
  const { valid, code, signedInAs } = loaderData;
  return (
    <section className="mx-auto mt-12 max-w-sm">
      <h1 className="text-2xl font-semibold">加入后记</h1>
      {!valid ? (
        <p className="mt-4 text-muted">这个邀请链接无效、过期，或者已经用过了。找邀请你的人要一个新的吧。</p>
      ) : signedInAs ? (
        <p className="mt-4 text-muted">
          你已经以 @{signedInAs} 登录。要注册新账号，先在
          <Link to="/settings" className="mx-1 underline underline-offset-4">
            设置
          </Link>
          里退出。
        </p>
      ) : (
        <>
          <p className="mt-2 mb-6 text-sm text-muted">
            有人邀请你来记录看过、读过、玩过的作品。选一个用户名，然后创建通行密钥就好，不需要密码。
          </p>
          <AccountForm kind="join" extra={{ invite: code }} submitLabel="创建账号" />
        </>
      )}
    </section>
  );
}
