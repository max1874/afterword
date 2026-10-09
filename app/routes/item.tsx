import { useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/item";
import { Cover } from "~/components/cover";
import { MarkForm } from "~/components/mark-form";
import { Stars } from "~/components/stars";
import { chosenTiles, isTileKey, profileFromParam, saveTile, usesRatings } from "~/lib/accounts.server";
import { fillDetailsNow, hasArtwork } from "~/lib/details.server";
import { parseMark } from "~/lib/catalog.server";
import { deleteMark, getItem, saveMark, today } from "~/lib/db.server";
import { backdropSrc, coverSrc, factsOf, joinText, monthDay } from "~/lib/format";
import { creatorLabel, isStatus, kindLabel, STATUSES, statusLabel, type Kind, type Status } from "~/lib/kinds";
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
  let item = await getItem(params.id, user.id);
  // Someone else's page only shows what they marked; your own also offers unmarked items to mark.
  if (!item || (!mine && !item.status)) throw data(null, { status: 404 });
  // The first visit waits briefly for the summary, so the page is not empty.
  if (await fillDetailsNow(item)) item = (await getItem(params.id, user.id)) ?? item;
  return {
    item: { ...item, cover: coverSrc(item), backdrop: backdropSrc(item), facts: factsOf(item) },
    profile: { handle: user.handle, name: user.name },
    mine,
    ratings: usesRatings(user),
    // Items are shared, so only an admin replaces their artwork.
    canChooseArtwork: Boolean(viewer?.is_admin) && hasArtwork(item),
    // Which of your kind tiles show this work, so the links offer to set or undo.
    tiles: mine ? (Object.entries(chosenTiles(user)).filter(([, id]) => id === item.id).map(([key]) => key) as string[]) : [],
    viewerHandle: viewer?.handle ?? null,
    today: today(),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await profileFromParam(params.profile);
  const viewer = await getViewer(request);
  if (viewer?.id !== user.id) throw data(null, { status: 403 });
  const form = await request.formData();

  // 设为磁贴封面: shows this work on one of your kind tiles, or goes back to the newest mark.
  if (form.get("intent") === "tile") {
    const key = form.get("key");
    const item = await getItem(params.id, user.id);
    if (!isTileKey(key) || !item || (key !== "all" && key !== item.kind)) throw data(null, { status: 400 });
    await saveTile(user, key, form.get("set") ? item.id : null);
    return redirect(`/@${user.handle}/items/${params.id}`);
  }

  if (form.get("intent") === "delete") {
    await deleteMark(user.id, params.id);
    return redirect(`/@${user.handle}`);
  }

  // The round buttons: change only the status, keeping the rest; a new status starts today.
  if (form.get("intent") === "status") {
    const status = form.get("status");
    const current = await getItem(params.id, user.id);
    if (!isStatus(status) || !current) throw data(null, { status: 400 });
    await saveMark(user.id, params.id, {
      status,
      rating: status === "wish" ? null : (current.rating ?? null),
      comment: current.comment ?? null,
      marked_on: current.status === status && current.marked_on ? current.marked_on : today(),
    });
    return redirect(`/@${user.handle}/items/${params.id}`);
  }

  const parsed = parseMark(form);
  if ("error" in parsed) return data({ error: parsed.error }, { status: 400 });
  if (!(await getItem(params.id, user.id))) throw data(null, { status: 404 });
  await saveMark(user.id, params.id, parsed.mark);
  return redirect(`/@${user.handle}/items/${params.id}`);
}

export default function ItemPage({ loaderData, actionData }: Route.ComponentProps) {
  const { item, profile, mine, ratings, canChooseArtwork, tiles, viewerHandle, today } = loaderData;
  const meta = [item.original_title, kindLabel(item.kind), item.year].filter(Boolean).join(" · ");
  const statusText = item.status ? `${statusLabel(item.status, item.kind)} · ${monthDay(item.marked_on!)}` : null;

  return (
    <article>
      {item.backdrop ? <Artwork src={item.backdrop} /> : <Backdrop src={item.cover} />}
      <header
        className={`flex flex-col items-center text-center sm:flex-row sm:items-end sm:gap-10 sm:text-left ${item.backdrop ? "pt-[min(34vw,330px)]" : ""}`}
      >
        {item.backdrop ? null : <Cover src={item.cover} title={item.title} className="w-[186px] shrink-0 sm:w-[220px]" />}
        <div className={`min-w-0 ${item.backdrop ? "" : "mt-6 sm:mt-0"}`}>
          <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.01em] sm:text-[44px]">{item.title}</h1>
          <p className="mt-1.5 text-[15px] text-muted">{meta}</p>
          {item.creators ? (
            <p className="mt-0.5 text-[15px] text-muted">
              {creatorLabel(item.kind)} {item.creators}
            </p>
          ) : null}

          <div className="mx-auto mt-5 w-full max-w-sm sm:mx-0">
            {mine ? (
              <>
                <QuickStatus kind={item.kind} current={item.status ?? null} />
                <p className="mt-2.5 text-center text-sm text-muted sm:text-left">
                  {item.status ? `${monthDay(item.marked_on!)}${statusLabel(item.status, item.kind)} · ` : "选一个状态标记它 · "}
                  <a href="#mark" className="font-medium text-ink hover:opacity-70">
                    {item.status ? "修改" : "写短评"}
                  </a>
                </p>
              </>
            ) : statusText ? (
              <p className="flex h-12 items-center justify-center rounded-full bg-card/80 text-[15px] font-semibold backdrop-blur">
                {joinText(profile.name, statusText)}
              </p>
            ) : null}
            {ratings && item.rating ? <Stars rating={item.rating} className="mt-3 block text-center text-lg sm:text-left" /> : null}
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
            <Summary text={item.summary} />
          </section>
        ) : null}

        {item.facts.length ? (
          <section>
            <h2 className="mb-2 text-xl font-bold">资料</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
              {item.facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {item.source_url || canChooseArtwork || mine ? (
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
            {item.source_url ? (
              <span>
                来源：
                <a href={item.source_url} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">
                  {/* Non-admin imports keep their source as `douban:<user id>`. */}
                  {SOURCE_LABELS[item.source.split(":")[0]] ?? item.source}
                </a>
              </span>
            ) : null}
            {canChooseArtwork ? (
              <Link to={`/@${profile.handle}/items/${item.id}/artwork`} className="underline decoration-line underline-offset-4 hover:decoration-ink">
                更换横图
              </Link>
            ) : null}
            {mine
              ? ([item.kind, "all"] as const).map((key) => {
                  const on = tiles.includes(key);
                  return (
                    <Form key={key} method="post">
                      <input type="hidden" name="intent" value="tile" />
                      <input type="hidden" name="key" value={key} />
                      {on ? null : <input type="hidden" name="set" value="1" />}
                      <button className="underline decoration-line underline-offset-4 hover:decoration-ink">
                        {on ? "恢复" : "设为"}「{key === "all" ? "全部" : kindLabel(key)}」磁贴{on ? "默认图" : "封面"}
                      </button>
                    </Form>
                  );
                })
              : null}
          </div>
        ) : null}

        {mine ? (
          <section id="mark" className="scroll-mt-6 rounded-2xl bg-card p-5 sm:p-6">
            <h2 className="mb-5 text-xl font-bold">{item.status ? "修改标记" : "标记这部作品"}</h2>
            {actionData && "error" in actionData ? (
              <p className="mb-4 text-sm text-danger">{actionData.error}</p>
            ) : null}
            <MarkForm key={`${item.status}:${item.marked_on ?? "new"}`} kind={item.kind} initial={item} today={today} ratings={ratings} />
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
            <Link to={`/@${viewerHandle}/items/${item.id}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">
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

/** Long Douban intros start folded to a few lines, as in the app. */
function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 120 || text.split("\n").length > 4;
  return (
    <>
      <p className={`whitespace-pre-wrap text-[15px] leading-relaxed text-muted ${long && !open ? "line-clamp-5" : ""}`}>{text}</p>
      {long && !open ? (
        <button onClick={() => setOpen(true)} className="mt-1 text-[15px] font-semibold hover:opacity-70">
          更多
        </button>
      ) : null}
    </>
  );
}

/** 看过 / 在看 / 想看 as round buttons, like Infuse's row under Resume: one press changes the status. */
function QuickStatus({ kind, current }: { kind: Kind; current: Status | null }) {
  const navigation = useNavigation();
  const pending = navigation.formData?.get("intent") === "status" ? navigation.formData.get("status") : null;
  const icons: Record<Status, React.ReactNode> = {
    done: <path d="M5 12.5l4.5 4.5L19 7.5" />,
    doing: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
    wish: <path d="M7 4h10v16l-5-3.6L7 20z" />,
  };
  return (
    <Form method="post" className="mt-3 flex gap-2">
      <input type="hidden" name="intent" value="status" />
      {STATUSES.map((s) => {
        const on = (pending ?? current) === s;
        return (
          <button
            key={s}
            name="status"
            value={s}
            title={statusLabel(s, kind)}
            className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition ${on ? "bg-ink text-paper" : "bg-card/80 backdrop-blur hover:opacity-70"}`}
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {icons[s]}
            </svg>
            {statusLabel(s, kind)}
          </button>
        );
      })}
    </Form>
  );
}

/** Landscape artwork across the top of the page, fading into it. */
function Artwork({ src }: { src: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[min(62vw,620px)] overflow-hidden">
      <img src={src} alt="" referrerPolicy="no-referrer" className="size-full object-cover object-top" />
      <div className="absolute inset-0 bg-gradient-to-b from-paper/30 from-0% via-transparent via-25% to-paper to-95%" />
    </div>
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
