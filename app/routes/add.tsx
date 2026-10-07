import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/add";
import { Cover } from "~/components/cover";
import { findBySource, insertItem, markedSourceIds, type NewItem } from "~/lib/db.server";
import { storeCover } from "~/lib/covers.server";
import { previewSrc } from "~/lib/format";
import { creatorLabel, isKind, KINDS, kindLabel, type Kind } from "~/lib/kinds";
import { searchAll } from "~/lib/providers.server";
import { requireViewer } from "~/lib/session.server";

export function meta() {
  return [{ title: "记一笔 · 后记" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireViewer(request);
  const params = new URL(request.url).searchParams;
  const kind: Kind = isKind(params.get("kind")) ? (params.get("kind") as Kind) : "screen";
  const query = params.get("q")?.trim() ?? "";
  if (!query) return { kind, query, groups: [] };

  const groups = await searchAll(kind, query);
  const withMarks = await Promise.all(
    groups.map(async (group) => {
      const existing = await markedSourceIds(
        viewer.id,
        group.source,
        group.items.map((i) => i.source_id!),
      );
      return {
        ...group,
        items: group.items.map((item) => ({ ...item, existingId: existing.get(item.source_id!) ?? null })),
      };
    }),
  );
  return { kind, query, groups: withMarks, handle: viewer.handle };
}

function text(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();
  return value || null;
}

export async function action({ request }: Route.ActionArgs) {
  const viewer = await requireViewer(request);
  const form = await request.formData();
  const kind = form.get("kind");
  if (!isKind(kind)) return data({ error: "类型无效" }, { status: 400 });

  let item: NewItem;
  if (form.get("intent") === "pick") {
    const source = text(form, "source");
    const sourceId = text(form, "source_id");
    const title = text(form, "title");
    if (!source || !sourceId || !title) return data({ error: "条目信息不完整" }, { status: 400 });
    const existing = await findBySource(source, sourceId);
    // Already in the catalog (maybe marked by someone else): mark it on your own page.
    if (existing) return redirect(`/@${viewer.handle}/items/${existing.id}`);
    item = {
      kind,
      title,
      original_title: text(form, "original_title"),
      year: Number(form.get("year")) || null,
      creators: text(form, "creators"),
      summary: text(form, "summary"),
      cover_url: text(form, "cover_url"),
      source,
      source_id: sourceId,
      source_url: text(form, "source_url"),
    };
  } else {
    const title = text(form, "title");
    if (!title) return data({ error: "请填写标题" }, { status: 400 });
    const coverUrl = text(form, "cover_url");
    if (coverUrl && !/^https?:\/\//.test(coverUrl)) {
      return data({ error: "封面需要是 http(s) 链接" }, { status: 400 });
    }
    item = {
      kind,
      title,
      original_title: text(form, "original_title"),
      year: Number(form.get("year")) || null,
      creators: text(form, "creators"),
      summary: text(form, "summary"),
      cover_url: coverUrl,
      source: "manual",
      source_id: null,
      source_url: null,
    };
  }

  const coverKey = await storeCover(item.cover_url);
  const id = await insertItem(item, coverKey, viewer.id);
  return redirect(`/@${viewer.handle}/items/${id}`);
}

export default function Add({ loaderData, actionData }: Route.ComponentProps) {
  const { kind, query, groups, handle } = loaderData;
  const navigation = useNavigation();
  const searching = navigation.state === "loading" && navigation.location?.pathname === "/add";
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold">记一笔</h1>

      <Form method="get" className="mb-10">
        <div className="mb-4 flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <label
              key={k}
              className="cursor-pointer rounded-full border border-line px-4 py-1.5 text-sm text-muted transition hover:text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper"
            >
              <input type="radio" name="kind" value={k} defaultChecked={k === kind} className="sr-only" />
              {kindLabel(k)}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="作品名，中文、原名都可以"
            autoFocus
            className="min-w-0 flex-1 text-base"
          />
          <button className="shrink-0 rounded-md bg-ink px-5 text-paper transition hover:opacity-85">
            {searching ? "搜索中…" : "搜索"}
          </button>
        </div>
      </Form>

      {actionData && "error" in actionData ? (
        <p className="mb-6 text-sm text-seal">{actionData.error}</p>
      ) : null}

      {query ? (
        <section className="space-y-10">
          {groups.map((group) => (
            <div key={group.source}>
              <h2 className="mb-3 flex items-baseline gap-2 text-sm text-muted">
                <span className="font-semibold text-ink">{group.label}</span>
                {group.error ? <span className="text-seal">搜索失败（{group.error}）</span> : <span>{group.items.length} 条</span>}
              </h2>
              <ul className="divide-y divide-line border-y border-line">
                {group.items.map((item) => (
                  <Candidate key={item.source_id} item={item} handle={handle} />
                ))}
              </ul>
            </div>
          ))}
          {total === 0 ? <p className="text-muted">没有搜到“{query}”。试试原名，或者在下面手动添加。</p> : null}
        </section>
      ) : null}

      <details className="mt-12 rounded-lg border border-line bg-card p-5 sm:p-6" open={Boolean(query) && total === 0}>
        <summary className="cursor-pointer select-none text-lg font-semibold">搜不到？手动添加</summary>
        <ManualForm kind={kind} />
      </details>

      <p className="mt-6 text-sm text-muted">
        有一批旧标记？
        <Link to="/import" className="ml-1 underline underline-offset-4 hover:text-ink">
          从文件导入
        </Link>
      </p>
    </>
  );
}

type CandidateItem = Route.ComponentProps["loaderData"]["groups"][number]["items"][number];

function Candidate({ item, handle }: { item: CandidateItem; handle: string }) {
  const navigation = useNavigation();
  const adding =
    navigation.state === "submitting" && navigation.formData?.get("source_id") === item.source_id;
  return (
    <li className="flex gap-4 py-4">
      <Cover src={previewSrc(item.cover_url)} title={item.title} className="w-16 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold">{item.title}</p>
        <p className="mt-0.5 text-sm text-muted">
          {[item.original_title, item.year, item.creators && `${creatorLabel(item.kind)} ${item.creators}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {item.summary ? <p className="mt-1.5 line-clamp-2 text-sm text-muted">{item.summary}</p> : null}
      </div>
      <div className="shrink-0 self-center">
        {item.existingId ? (
          <Link to={`/@${handle}/items/${item.existingId}`} className="text-sm text-muted underline underline-offset-4 hover:text-ink">
            已标记
          </Link>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="pick" />
            {(
              ["kind", "title", "original_title", "year", "creators", "summary", "cover_url", "source", "source_id", "source_url"] as const
            ).map((field) => (
              <input key={field} type="hidden" name={field} value={item[field] ?? ""} />
            ))}
            <button
              disabled={adding}
              className="rounded-full border border-seal px-4 py-1.5 text-sm text-seal transition hover:bg-seal hover:text-seal-ink disabled:opacity-60"
            >
              {adding ? "标记中…" : "标记"}
            </button>
          </Form>
        )}
      </div>
    </li>
  );
}

function ManualForm({ kind }: { kind: Kind }) {
  return (
    <Form method="post" className="mt-5 grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="intent" value="manual" />
      <label className="block sm:col-span-2">
        <span className="mb-1.5 block text-sm text-muted">类型</span>
        <select name="kind" defaultValue={kind}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
      </label>
      <Field name="title" label="标题" required />
      <Field name="original_title" label="原名" />
      <Field name="year" label="年份" type="number" />
      <Field name="creators" label="作者 / 导演 / 开发" />
      <Field name="cover_url" label="封面图片链接" type="url" className="sm:col-span-2" />
      <label className="block sm:col-span-2">
        <span className="mb-1.5 block text-sm text-muted">简介</span>
        <textarea name="summary" rows={3} className="w-full" />
      </label>
      <div className="sm:col-span-2">
        <button className="rounded-full bg-seal px-6 py-2 text-seal-ink transition hover:opacity-90">添加并标记</button>
      </div>
    </Form>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
  className = "",
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      <input name={name} type={type} required={required} className="w-full" />
    </label>
  );
}
