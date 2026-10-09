import { env } from "cloudflare:workers";
import { useEffect, useState } from "react";
import { data, Form, useFetcher, useRevalidator, useSearchParams } from "react-router";

import type { Route } from "./+types/settings";
import { RecoveryCodes } from "~/components/recovery-codes";
import {
  avatarSrc,
  createInvite,
  deleteAccount,
  deleteOtherSessions,
  deletePasskey,
  deleteSession,
  getUser,
  listInvites,
  listPasskeys,
  listSessions,
  recoveryCodeStatements,
  removeAvatar,
  revokeInvite,
  saveAvatar,
  saveProfile,
  saveRatings,
  unusedRecoveryCodes,
  usesRatings,
} from "~/lib/accounts.server";
import { passkeyMessage, registerPasskey, signal, userHandle } from "~/lib/passkey";
import { logOut, requireViewer } from "~/lib/session.server";

export function meta() {
  return [{ title: "设置 · 后记" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireViewer(request);
  const [user, passkeys, sessions, recoveryLeft, invites] = await Promise.all([
    getUser(viewer.id),
    listPasskeys(viewer.id),
    listSessions(viewer.id),
    unusedRecoveryCodes(viewer.id),
    viewer.is_admin ? listInvites(viewer.id) : Promise.resolve(null),
  ]);
  return {
    me: { id: viewer.id, handle: viewer.handle, name: viewer.name, avatar: avatarSrc(viewer) },
    ratings: usesRatings(user),
    passkeys,
    sessions: sessions.map((s) => ({ ...s, current: s.id === viewer.session_id })),
    recoveryLeft,
    invites,
    origin: new URL(request.url).origin,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const viewer = await requireViewer(request);
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");

  switch (field("intent")) {
    case "ratings":
      await saveRatings(viewer.id, field("ratings") === "on");
      return { intent: "ratings" };
    case "avatar": {
      const file = form.get("avatar");
      if (!(file instanceof File)) return data({ intent: "avatar", error: "没有收到图片" }, { status: 400 });
      const result = await saveAvatar(viewer, await file.arrayBuffer(), file.type);
      if ("error" in result) return data({ intent: "avatar", error: result.error }, { status: 400 });
      return { intent: "avatar" };
    }
    case "remove-avatar":
      await removeAvatar(viewer);
      return { intent: "avatar" };
    case "profile": {
      const result = await saveProfile(viewer.id, form);
      if ("error" in result) return data({ intent: "profile", error: result.error }, { status: 400 });
      return { intent: "profile", saved: result.saved };
    }
    case "delete-passkey": {
      if (!(await deletePasskey(viewer.id, field("id")))) {
        return data({ intent: "passkeys", error: "至少要留一个通行密钥" }, { status: 400 });
      }
      return { intent: "passkeys", remaining: (await listPasskeys(viewer.id)).map((p) => p.id) };
    }
    case "delete-session":
      await deleteSession(viewer.id, field("id"));
      return { intent: "sessions" };
    case "delete-account": {
      if (field("handle").replace(/^@/, "").toLowerCase() !== viewer.handle) {
        return data({ intent: "delete-account", error: "输入你的用户名以确认删除" }, { status: 400 });
      }
      await deleteAccount(viewer);
      return logOut(request);
    }
    case "delete-other-sessions":
      await deleteOtherSessions(viewer.id, viewer.session_id);
      return { intent: "sessions" };
    case "recovery-codes": {
      const { codes, statements } = await recoveryCodeStatements(viewer.id);
      await env.DB.batch(statements);
      return { intent: "recovery", codes };
    }
    case "create-invite":
      if (!viewer.is_admin) throw data(null, { status: 403 });
      return { intent: "invites", created: await createInvite(viewer.id) };
    case "revoke-invite":
      if (!viewer.is_admin) throw data(null, { status: 403 });
      await revokeInvite(viewer.id, field("code"));
      return { intent: "invites" };
    default:
      throw data(null, { status: 400 });
  }
}

type Data = Route.ComponentProps["loaderData"];

export default function Settings({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  return (
    <div className="mx-auto max-w-2xl space-y-12">
      <h1 className="text-3xl font-semibold">设置</h1>
      {params.get("recovered") ? (
        <p className="rounded-lg border border-ink px-4 py-3 text-sm">
          你用恢复码登录了。给这台设备添加一个通行密钥，下次就不用恢复码了；也可以重新生成一组恢复码。
        </p>
      ) : null}
      <Profile me={loaderData.me} />
      <Ratings on={loaderData.ratings} />
      <Passkeys data={loaderData} />
      <Sessions sessions={loaderData.sessions} />
      <Recovery left={loaderData.recoveryLeft} handle={loaderData.me.handle} />
      {loaderData.invites ? <Invites invites={loaderData.invites} origin={loaderData.origin} /> : null}
      <DeleteAccount handle={loaderData.me.handle} />
      <Form method="post" action="/logout" className="border-t border-line pt-6">
        <button className="text-sm text-muted hover:text-danger">退出登录</button>
      </Form>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      {note ? <p className="mt-1 text-sm text-muted">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Star ratings on or off; off hides them from your pages and forms and keeps the ones saved. */
function Ratings({ on }: { on: boolean }) {
  const fetcher = useFetcher();
  const shown = fetcher.formData ? fetcher.formData.get("ratings") === "on" : on;
  return (
    <Section title="评分" note="关掉后，你的页面和标记表单都不再显示星级；已有的评分会保留。">
      <fetcher.Form method="post" className="flex items-center justify-between rounded-2xl bg-card px-5 py-4">
        <input type="hidden" name="intent" value="ratings" />
        <label htmlFor="ratings" className="font-medium">
          使用星级评分
        </label>
        <button
          id="ratings"
          name="ratings"
          value={shown ? "off" : "on"}
          role="switch"
          aria-checked={shown}
          className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition ${shown ? "bg-[#34c759]" : "bg-line"}`}
        >
          <span
            className={`absolute top-[2px] size-[27px] rounded-full bg-white shadow transition-all ${shown ? "left-[22px]" : "left-[2px]"}`}
          />
        </button>
      </fetcher.Form>
    </Section>
  );
}

function formatTime(sql: string | null) {
  if (!sql) return "从未";
  const date = new Date(`${sql.replace(" ", "T")}Z`);
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" });
}

function Profile({ me }: { me: Data["me"] }) {
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data?.intent === "profile" ? fetcher.data : null;

  useEffect(() => {
    if (!result || !("saved" in result) || !result.saved) return;
    // Keep the passkey provider's account label in step with the new name.
    signal({
      signalName: "currentUserDetails",
      rpID: location.hostname,
      userID: userHandle(me.id),
      name: result.saved.handle,
      displayName: result.saved.name,
    });
  }, [result, me.id]);

  return (
    <Section title="资料" note={`主页地址：/@${me.handle}`}>
      <Avatar me={me} />
      <fetcher.Form method="post" className="mt-5 grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="intent" value="profile" />
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">名字</span>
          <input name="name" defaultValue={me.name} maxLength={40} required className="w-full" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">用户名</span>
          <input name="handle" defaultValue={me.handle} pattern="@?[a-zA-Z0-9_]{2,20}" required className="w-full" />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="rounded-full bg-ink px-5 py-1.5 text-sm text-paper transition hover:opacity-85">保存</button>
          {result && "error" in result ? <span className="text-sm text-danger">{result.error}</span> : null}
          {result && "saved" in result ? <span className="text-sm text-muted">已保存</span> : null}
        </div>
      </fetcher.Form>
    </Section>
  );
}

/** The photo beside your name: choosing a file uploads it straight away. */
function Avatar({ me }: { me: Data["me"] }) {
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data?.intent === "avatar" ? fetcher.data : null;
  const busy = fetcher.state !== "idle";
  return (
    <div className="flex items-center gap-4">
      <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-b from-[#8e8e93] to-[#636366] text-2xl font-semibold text-white">
        {me.avatar ? <img src={me.avatar} alt="" className="size-full object-cover" /> : me.name.slice(0, 1).toUpperCase()}
      </span>
      <fetcher.Form method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-3 text-sm">
        <label className={`cursor-pointer rounded-full bg-card px-4 py-1.5 font-medium transition hover:opacity-80 ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? "上传中…" : me.avatar ? "更换头像" : "上传头像"}
          <input
            type="file"
            name="avatar"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={(event) => {
              const form = event.currentTarget.form;
              if (event.currentTarget.files?.length && form) {
                const body = new FormData(form);
                body.set("intent", "avatar");
                fetcher.submit(body, { method: "post", encType: "multipart/form-data" });
              }
            }}
          />
        </label>
        {me.avatar ? (
          <button name="intent" value="remove-avatar" disabled={busy} className="text-muted hover:text-ink">
            移除
          </button>
        ) : null}
        {result && "error" in result ? <span className="text-danger">{result.error}</span> : null}
      </fetcher.Form>
    </div>
  );
}

function Passkeys({ data: loaderData }: { data: Data }) {
  const { passkeys, me } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = fetcher.data?.intent === "passkeys" ? fetcher.data : null;

  useEffect(() => {
    if (!result || !("remaining" in result) || !result.remaining) return;
    // The provider can drop the deleted passkey instead of offering it at sign-in.
    signal({
      signalName: "allAcceptedCredentials",
      rpID: location.hostname,
      userID: userHandle(me.id),
      allAcceptedCredentialIDs: result.remaining,
    });
  }, [result, me.id]);

  async function add() {
    setAdding(true);
    setError(null);
    try {
      await registerPasskey("add");
      revalidator.revalidate();
    } catch (e) {
      setError(passkeyMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Section title="通行密钥" note="每台常用设备或密码管理器各一个。登录时用其中任意一个。">
      <ul className="divide-y divide-line border-y border-line">
        {passkeys.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p>{p.name}</p>
              <p className="text-sm text-muted">
                添加于 {formatTime(p.created_at)} · 上次使用 {formatTime(p.last_used_at)}
              </p>
            </div>
            <fetcher.Form
              method="post"
              onSubmit={(event) => {
                if (!window.confirm(`删除「${p.name}」？之后不能再用它登录。`)) event.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete-passkey" />
              <input type="hidden" name="id" value={p.id} />
              <button disabled={passkeys.length <= 1} className="text-sm text-muted hover:text-danger disabled:opacity-40">
                删除
              </button>
            </fetcher.Form>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={adding}
          className="rounded-full border border-line px-4 py-1.5 text-sm transition hover:border-muted disabled:opacity-60"
        >
          {adding ? "等待通行密钥…" : "＋ 添加通行密钥"}
        </button>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
        {result && "error" in result ? <span className="text-sm text-danger">{result.error}</span> : null}
      </div>
    </Section>
  );
}

/** "Mac · Chrome" from a user agent; good enough to tell your devices apart. */
function describeAgent(ua: string | null) {
  if (!ua) return "未知设备";
  const os =
    /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "未知系统";
  const browser =
    /^Afterword-iOS\//.test(ua) ? "后记 App" : /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "浏览器";
  return `${os} · ${browser}`;
}

function Sessions({ sessions }: { sessions: Data["sessions"] }) {
  const fetcher = useFetcher<typeof action>();
  return (
    <Section title="登录的设备" note="不认识的设备可以让它退出。">
      <ul className="divide-y divide-line border-y border-line">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p>
                {describeAgent(s.user_agent)}
                {s.current ? <span className="ml-2 text-sm text-muted">这台设备</span> : null}
              </p>
              <p className="text-sm text-muted">
                登录于 {formatTime(s.created_at)} · 最近活动 {formatTime(s.last_seen_at)}
              </p>
            </div>
            {s.current ? null : (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="delete-session" />
                <input type="hidden" name="id" value={s.id} />
                <button className="text-sm text-muted hover:text-danger">退出</button>
              </fetcher.Form>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 ? (
        <fetcher.Form method="post" className="mt-4">
          <input type="hidden" name="intent" value="delete-other-sessions" />
          <button className="text-sm text-muted underline underline-offset-4 hover:text-danger">退出其他所有设备</button>
        </fetcher.Form>
      ) : null}
    </Section>
  );
}

function Recovery({ left, handle }: { left: number; handle: string }) {
  const fetcher = useFetcher<typeof action>();
  const [hidden, setHidden] = useState(false);
  const codes = fetcher.data?.intent === "recovery" && "codes" in fetcher.data ? fetcher.data.codes : null;

  if (codes && !hidden) return <RecoveryCodes codes={codes} handle={handle} onDone={() => setHidden(true)} />;

  return (
    <Section title="恢复码" note={`没有通行密钥时用来登录。还剩 ${left} 个可用。`}>
      <fetcher.Form
        method="post"
        onSubmit={(event) => {
          if (left > 0 && !window.confirm("重新生成后，旧的恢复码全部作废。继续？")) event.preventDefault();
          else setHidden(false);
        }}
      >
        <input type="hidden" name="intent" value="recovery-codes" />
        <button className="rounded-full border border-line px-4 py-1.5 text-sm transition hover:border-muted">
          重新生成恢复码
        </button>
      </fetcher.Form>
    </Section>
  );
}

function Invites({ invites, origin }: { invites: NonNullable<Data["invites"]>; origin: string }) {
  const fetcher = useFetcher<typeof action>();
  const [copied, setCopied] = useState<string | null>(null);
  const link = (code: string) => `${origin}/join/${code}`;
  const now = Date.now();

  return (
    <Section title="邀请" note="每个邀请链接只能注册一个账号，14 天内有效。">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="create-invite" />
        <button className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper transition hover:opacity-85">
          生成邀请链接
        </button>
      </fetcher.Form>
      {invites.length ? (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {invites.map((invite) => {
            const expired = !invite.used_at && Date.parse(`${invite.expires_at.replace(" ", "T")}Z`) < now;
            return (
              <li key={invite.code} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{link(invite.code)}</p>
                  <p className="text-sm text-muted">
                    {invite.used_at
                      ? `@${invite.used_handle ?? "已删除的账号"} 于 ${formatTime(invite.used_at)} 注册`
                      : expired
                        ? "已过期"
                        : `有效期至 ${formatTime(invite.expires_at)}`}
                  </p>
                </div>
                {invite.used_at || expired ? null : (
                  <div className="flex items-center gap-4 text-sm">
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(link(invite.code)).then(() => setCopied(invite.code))}
                      className="text-muted hover:text-ink"
                    >
                      {copied === invite.code ? "已复制" : "复制"}
                    </button>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="revoke-invite" />
                      <input type="hidden" name="code" value={invite.code} />
                      <button className="text-muted hover:text-danger">作废</button>
                    </fetcher.Form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}

/** 删除账号: typing the handle again is the confirmation, since nothing can bring it back. */
function DeleteAccount({ handle }: { handle: string }) {
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data?.intent === "delete-account" ? fetcher.data : null;
  return (
    <Section title="删除账号" note="你的标记、短评、评分、头像、通行密钥和登录的设备都会删除，不能恢复。你添加过的作品条目会留在作品库里，不再带你的名字。">
      <fetcher.Form method="post" className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="intent" value="delete-account" />
        <input name="handle" placeholder={`输入 ${handle} 确认`} autoComplete="off" required className="w-56" />
        <button
          disabled={fetcher.state !== "idle"}
          className="rounded-full border border-danger px-5 py-1.5 text-sm text-danger transition hover:bg-danger hover:text-paper"
        >
          永久删除账号
        </button>
        {result && "error" in result ? <span className="text-sm text-danger">{result.error}</span> : null}
      </fetcher.Form>
    </Section>
  );
}
