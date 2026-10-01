import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/item";
import { Cover } from "~/components/cover";
import { MarkForm } from "~/components/mark-form";
import { Stars } from "~/components/stars";
import { deleteItem, getItem, saveMark, today } from "~/lib/db.server";
import { coverSrc } from "~/lib/format";
import { creatorLabel, isStatus, kindLabel, statusLabel } from "~/lib/kinds";
import { isOwner, requireOwner } from "~/lib/session.server";

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
  const item = await getItem(params.id);
  if (!item) throw data(null, { status: 404 });
  return { item: { ...item, cover: coverSrc(item) }, owner: await isOwner(request), today: today() };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOwner(request);
  const form = await request.formData();

  if (form.get("intent") === "delete") {
    await deleteItem(params.id);
    return redirect("/");
  }

  const status = form.get("status");
  const markedOn = String(form.get("marked_on") ?? "");
  const rating = Number(form.get("rating"));
  const comment = String(form.get("comment") ?? "").trim();
  if (!isStatus(status) || !/^\d{4}-\d{2}-\d{2}$/.test(markedOn)) {
    return data({ error: "状态或日期无效" }, { status: 400 });
  }
  if (!(await getItem(params.id))) throw data(null, { status: 404 });
  await saveMark(params.id, {
    status,
    rating: status !== "wish" && rating >= 1 && rating <= 5 ? Math.round(rating) : null,
    comment: comment || null,
    marked_on: markedOn,
  });
  return redirect(`/items/${params.id}`);
}

export default function ItemPage({ loaderData, actionData }: Route.ComponentProps) {
  const { item, owner, today } = loaderData;
  const meta = [kindLabel(item.kind), item.year, item.creators && `${creatorLabel(item.kind)} ${item.creators}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="grid gap-8 sm:grid-cols-[180px_1fr] sm:gap-10">
      <Cover src={item.cover} title={item.title} className="w-36 sm:w-full" />

      <div className="min-w-0">
        <h1 className="font-serif text-3xl leading-tight sm:text-4xl">{item.title}</h1>
        {item.original_title ? <p className="mt-2 text-muted">{item.original_title}</p> : null}
        <p className="mt-3 text-sm text-muted">
          {meta}
          {item.source_url ? (
            <>
              {" · "}
              <a href={item.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
                {SOURCE_LABELS[item.source] ?? item.source}
              </a>
            </>
          ) : null}
        </p>

        {item.status ? (
          <section className="mt-8 border-l-2 border-seal pl-5">
            <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
              <span>{item.marked_on}</span>
              <span className="text-ink">{statusLabel(item.status, item.kind)}</span>
              <Stars rating={item.rating ?? null} />
            </p>
            {item.comment ? (
              <p className="mt-3 whitespace-pre-wrap font-serif text-lg leading-relaxed">{item.comment}</p>
            ) : null}
          </section>
        ) : null}

        {item.summary ? (
          <details className="mt-8 text-sm leading-relaxed text-muted">
            <summary className="cursor-pointer select-none text-ink">简介</summary>
            <p className="mt-3 whitespace-pre-wrap">{item.summary}</p>
          </details>
        ) : null}

        {owner ? (
          <section className="mt-10 rounded-lg border border-line bg-card p-5 sm:p-6">
            <h2 className="mb-5 font-serif text-xl">{item.status ? "修改标记" : "标记这部作品"}</h2>
            {actionData && "error" in actionData ? (
              <p className="mb-4 text-sm text-seal">{actionData.error}</p>
            ) : null}
            <MarkForm key={item.marked_on ?? "new"} kind={item.kind} initial={item} today={today} />
            <Form
              method="post"
              className="mt-6 border-t border-line pt-4"
              onSubmit={(event) => {
                if (!window.confirm("删除这条记录？标记和条目都会删除。")) event.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <button className="text-sm text-muted hover:text-seal">删除这条记录</button>
            </Form>
          </section>
        ) : null}

        <p className="mt-10 text-sm">
          <Link to="/" className="text-muted hover:text-ink">
            ← 返回
          </Link>
        </p>
      </div>
    </article>
  );
}
