import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/item";
import { Cover } from "~/components/cover";
import { MarkForm } from "~/components/mark-form";
import { Stars } from "~/components/stars";
import { profileFromParam } from "~/lib/accounts.server";
import { parseMark } from "~/lib/catalog.server";
import { deleteMark, getItem, saveMark, today } from "~/lib/db.server";
import { coverSrc, joinText } from "~/lib/format";
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
  const meta = [kindLabel(item.kind), item.year, item.creators && `${creatorLabel(item.kind)} ${item.creators}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="grid gap-8 sm:grid-cols-[180px_1fr] sm:gap-10">
      <Cover src={item.cover} title={item.title} className="w-36 sm:w-full" />

      <div className="min-w-0">
        <h1 className="text-3xl font-semibold sm:text-4xl">{item.title}</h1>
        {item.original_title ? <p className="mt-2 text-xl font-semibold text-muted">{item.original_title}</p> : null}
        <p className="mt-3 text-sm text-muted">
          {meta}
          {item.source_url ? (
            <>
              {" · "}
              <a href={item.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
                {/* Non-admin imports keep their source as `douban:<user id>`. */}
                {SOURCE_LABELS[item.source.split(":")[0]] ?? item.source}
              </a>
            </>
          ) : null}
        </p>

        {item.status ? (
          <section className="mt-8 border-l-2 border-seal pl-5">
            {mine ? null : <p className="mb-2 text-sm font-semibold">{profile.name}</p>}
            <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
              <span>{item.marked_on}</span>
              <span className="text-ink">{statusLabel(item.status, item.kind)}</span>
              <Stars rating={item.rating ?? null} />
            </p>
            {item.comment ? (
              <p className="mt-3 whitespace-pre-wrap">{item.comment}</p>
            ) : null}
          </section>
        ) : null}

        {item.summary ? (
          <details className="mt-8 text-muted">
            <summary className="cursor-pointer select-none text-ink">简介</summary>
            <p className="mt-3 whitespace-pre-wrap">{item.summary}</p>
          </details>
        ) : null}

        {mine ? (
          <section className="mt-10 rounded-lg border border-line bg-card p-5 sm:p-6">
            <h2 className="mb-5 text-xl font-semibold">{item.status ? "修改标记" : "标记这部作品"}</h2>
            {actionData && "error" in actionData ? (
              <p className="mb-4 text-sm text-seal">{actionData.error}</p>
            ) : null}
            <MarkForm key={item.marked_on ?? "new"} kind={item.kind} initial={item} today={today} />
            <Form
              method="post"
              className="mt-6 border-t border-line pt-4"
              onSubmit={(event) => {
                if (!window.confirm("删除这条标记？")) event.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <button className="text-sm text-muted hover:text-seal">删除这条标记</button>
            </Form>
          </section>
        ) : null}

        {!mine && viewerHandle ? (
          <p className="mt-8 text-sm">
            <Link
              to={`/@${viewerHandle}/items/${item.id}`}
              className="text-seal underline underline-offset-4"
            >
              我的标记
            </Link>
          </p>
        ) : null}

        <p className="mt-10 text-sm">
          <Link to={`/@${profile.handle}`} className="text-muted hover:text-ink">
            ← {mine ? "返回" : joinText(profile.name, "的后记")}
          </Link>
        </p>
      </div>
    </article>
  );
}
