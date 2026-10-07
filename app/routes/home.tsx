import { Link, redirect } from "react-router";

import type { Route } from "./+types/home";
import { firstAdmin, passkeyCount } from "~/lib/accounts.server";
import { joinText } from "~/lib/format";
import { getViewer } from "~/lib/session.server";

export function meta() {
  return [{ title: "后记" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await getViewer(request);
  if (viewer) throw redirect(`/@${viewer.handle}`);
  const admin = await firstAdmin();
  const needsSetup = !admin || (await passkeyCount(admin.id)) === 0;
  return { needsSetup, showcase: admin && !needsSetup ? { handle: admin.handle, name: admin.name } : null };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { needsSetup, showcase } = loaderData;
  return (
    <section className="mx-auto max-w-2xl py-16 sm:py-24">
      <h1 className="text-4xl font-semibold">看过、读过、玩过的，都记在这里。</h1>
      <p className="mt-5 text-xl text-muted">
        后记是一个开源的个人书影音记录。影视、书、漫画、游戏，按时间排成一面封面墙；搜不到的作品也能手动添加。
      </p>
      <div className="mt-10 flex flex-wrap items-center gap-4">
        {needsSetup ? (
          <Link to="/setup" className="rounded-full bg-seal px-6 py-2.5 text-seal-ink transition hover:opacity-90">
            完成初始设置
          </Link>
        ) : (
          <Link to="/login" className="rounded-full bg-ink px-6 py-2.5 text-paper transition hover:opacity-85">
            用通行密钥登录
          </Link>
        )}
        {showcase ? (
          <Link to={`/@${showcase.handle}`} className="text-muted underline underline-offset-4 hover:text-ink">
            {joinText("看看", joinText(showcase.name, "的后记"))}
          </Link>
        ) : null}
      </div>
      <p className="mt-6 text-sm text-muted">目前只接受邀请注册。</p>
    </section>
  );
}
