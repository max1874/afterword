import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/item";
import { Cover } from "~/components/cover";
import { MarkForm } from "~/components/mark-form";
import { Stars } from "~/components/stars";
import { profileFromParam } from "~/lib/accounts.server";
import { parseMark } from "~/lib/catalog.server";
import { deleteMark, getItem, saveMark, today } from "~/lib/db.server";
import { coverSrc, joinText, monthDay } from "~/lib/format";
import { creatorLabel, kindLabel, statusLabel } from "~/lib/kinds";
import { getViewer } from "~/lib/session.server";

const SOURCE_LABELS: Record<string, string> = {
  bangumi: "Bangumi",
  tmdb: "TMDB",
  googlebooks: "Google Books",
  douban: "豆瓣",
};

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.item.title} · 后记` : "后记" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await profileFromParam(params.profile);
  const viewer = await getViewer(request);
  const mine = viewer?.id === user.id;
  const item = await getItem(params.id, user.id);
  // Someone else's page only shows what they marked; your own also offers unmarked items to mark.
  if (!item || (!mine && !item.status)) throw data(null, { status: 404 });
  return {
    item: { ...item, cover: coverSrc(item) },
    profile: { handle: user.handle, name: user.name },
    mine,
    viewerHandle: viewer?.handle ?? null,
    today: today(),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await profileFromParam(params.profile);
  const viewer = await getViewer(request);
  if (viewer?.id !== user.id) throw data(null, { status: 403 });
  const form = await request.formData();

  if (form.get("intent") === "delete") {
    await deleteMark(user.id, params.id);
    return redirect(`/@${user.handle}`);
  }

  const parsed = parseMark(form);
  if ("error" in parsed) return data({ error: parsed.error }, { status: 400 });
  if (!(await getItem(params.id, user.id))) throw data(null, { status: 404 });
  await saveMark(user.id, params.id, parsed.mark);
  return redirect(`/@${user.handle}/items/${params.id}`);
}

export default function ItemPage({ loaderData, actionData }: Route.ComponentProps) {
  const { item, profile, mine, viewerHandle, today } = loaderData;
  const meta = [item.original_title, kindLabel(item.kind), item.year].filter(Boolean).join(" · ");

  return (
    <article>
      <Backdrop src={item.cover} />
      <header className="flex flex-col items-center text-center sm:flex-row sm:items-end sm:gap-10 sm:text-left">
        <Cover src={item.cover} title={item.title} className="w-[186px] shrink-0 sm:w-[220px]" />
        <div className="mt-6 min-w-0 sm:mt-0">
          <h1 className="text-[26px] leading-tight font-bold tracking-[-0.01em] sm:text-[40px]">{item.title}</h1>
          <p className="mt-1.5 text-[15px] text-muted">{meta}</p>
          {item.creators ? (
            <p className="mt-0.5 text-[15px] text-muted">
              {creatorLabel(item.kind)} {item.creators}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-4">
            {item.status ? (
              mine ? (
                <StatusPill href="#mark">
                  ✓ {statusLabel(item.status, item.kind)} · {monthDay(item.marked_on!)}
                </StatusPill>
              ) : (
                <StatusPill>
                  {joinText(profile.name, statusLabel(item.status, item.kind))} · {monthDay(item.marked_on!)}
                </StatusPill>
              )
            ) : mine ? (
              <StatusPill href="#mark">＋ 标记这部作品</StatusPill>
            ) : null}
            {item.rating ? <Stars rating={item.rating} className="text-lg" /> : null}
          </div>
        </div>
      </header>

      <div className="mx-auto mt-10 max-w-3xl space-y-8 sm:mx-0">
        {item.comment ? (
          <section>
            <h2 className="mb-2 text-xl font-bold">{mine ? "我的短评" : "短评"}</h2>
            <p className="rounded-2xl bg-card px-5 py-4 whitespace-pre-wrap">{item.comment}</p>
          </section>
        ) : null}

        {item.summary ? (
          <section>
            <h2 className="mb-2 text-xl font-bold">简介</h2>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-muted">{item.summary}</p>
          </section>
        ) : null}

        {item.source_url ? (
          <p className="text-sm text-muted">
            来源：
            <a href={item.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
              {/* Non-admin imports keep their source as `douban:<user id>`. */}
              {SOURCE_LABELS[item.source.split(":")[0]] ?? item.source}
            </a>
          </p>
        ) : null}

        {mine ? (
          <section id="mark" className="scroll-mt-6 rounded-2xl bg-card p-5 sm:p-6">
            <h2 className="mb-5 text-xl font-bold">{item.status ? "修改标记" : "标记这部作品"}</h2>
            {actionData && "error" in actionData ? (
              <p className="mb-4 text-sm text-danger">{actionData.error}</p>
            ) : null}
            <MarkForm key={item.marked_on ?? "new"} kind={item.kind} initial={item} today={today} />
            {item.status ? (
              <Form
                method="post"
                className="mt-6 border-t border-line pt-4"
                onSubmit={(event) => {
                  if (!window.confirm("删除这条标记？")) event.preventDefault();
                }}
              >
                <input type="hidden" name="intent" value="delete" />
                <button className="text-sm text-danger hover:opacity-80">删除这条标记</button>
              </Form>
            ) : null}
          </section>
        ) : null}

        {!mine && viewerHandle ? (
          <p className="text-sm">
            <Link to={`/@${viewerHandle}/items/${item.id}`} className="underline underline-offset-4">
              我的标记
            </Link>
          </p>
        ) : null}

        <p className="text-sm">
          <Link to={`/@${profile.handle}`} className="text-muted hover:text-ink">
            ← {mine ? "返回" : joinText(profile.name, "的后记")}
          </Link>
        </p>
      </div>
    </article>
  );
}

/** The cover, blurred and faded into the page behind the top of it, edge to edge. */
function Backdrop({ src }: { src: string | null }) {
  if (!src) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] overflow-hidden">
      <img src={src} alt="" referrerPolicy="no-referrer" className="size-full scale-125 object-cover opacity-50 blur-[60px] saturate-150" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-paper/40 to-paper" />
    </div>
  );
}

/** Your own mark is a button to the form; someone else's is a label. */
function StatusPill({ href, children }: { href?: string; children: React.ReactNode }) {
  const className = "inline-flex h-11 items-center rounded-full px-6 text-[15px] font-semibold";
  return href ? (
    <a href={href} className={`${className} bg-ink text-paper transition hover:opacity-85`}>
      {children}
    </a>
  ) : (
    <span className={`${className} bg-card/80 backdrop-blur`}>{children}</span>
  );
}
