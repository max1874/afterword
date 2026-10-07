import { env } from "cloudflare:workers";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";

import type { Route } from "./+types/home";
import { Cover } from "~/components/cover";
import { Stars } from "~/components/stars";
import { countByKindAndStatus, countByYear, listMarked } from "~/lib/db.server";
import { coverSrc, joinText } from "~/lib/format";
import {
  genericStatusLabel,
  isKind,
  isStatus,
  KINDS,
  kindLabel,
  STATUSES,
  statusLabel,
  type Kind,
  type Status,
} from "~/lib/kinds";
import { useRoot } from "~/root";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: joinText(loaderData?.ownerName ?? "", "的后记") }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const kind = isKind(params.get("kind")) ? (params.get("kind") as Kind) : undefined;
  const status = isStatus(params.get("status")) ? (params.get("status") as Status) : undefined;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [{ items, hasMore }, counts, yearCounts] = await Promise.all([
    listMarked({ kind, status, page }),
    countByKindAndStatus(),
    countByYear({ kind, status }),
  ]);
  return {
    ownerName: env.OWNER_NAME || "我",
    kind,
    status,
    page,
    hasMore,
    counts,
    yearCounts,
    items: items.map((item) => ({ ...item, cover: coverSrc(item) })),
  };
}

function filterParams(kind: Kind | undefined, status: Status | undefined) {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (status) params.set("status", status);
  return params;
}

function href(kind: Kind | undefined, status: Status | undefined) {
  const query = filterParams(kind, status).toString();
  return query ? `/?${query}` : "/";
}

type Counts = Route.ComponentProps["loaderData"]["counts"];

function total(counts: Counts, kind?: Kind, status?: Status) {
  return counts
    .filter((c) => (!kind || c.kind === kind) && (!status || c.status === status))
    .reduce((sum, c) => sum + c.n, 0);
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { ownerName, kind, status, counts, items } = loaderData;
  const root = useRoot();

  return (
    <>
      <section className="mb-10 border-b border-line pb-8">
        <h1 className="text-3xl font-semibold sm:text-4xl">{joinText(ownerName, "的后记")}</h1>
        <p className="mt-3 text-xl font-semibold text-muted">
          看过 {total(counts, "screen", "done")} 部影视 · 读过 {total(counts, "book", "done")} 本书 ·
          读过 {total(counts, "comic", "done")} 部漫画 · 玩过 {total(counts, "game", "done")} 款游戏
        </p>
      </section>

      <nav className="mb-3 flex flex-wrap gap-x-6 gap-y-2 text-lg font-semibold">
        <FilterLink to={href(undefined, status)} active={!kind}>
          全部
        </FilterLink>
        {KINDS.map((k) => (
          <FilterLink key={k} to={href(k, status)} active={kind === k}>
            {kindLabel(k)}
            <sup className="ml-0.5 font-sans text-xs text-muted">{total(counts, k)}</sup>
          </FilterLink>
        ))}
      </nav>
      <nav className="mb-10 flex flex-wrap gap-2 text-sm">
        <Chip to={href(kind, undefined)} active={!status}>
          全部
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} to={href(kind, s)} active={status === s}>
            {kind ? statusLabel(s, kind) : genericStatusLabel(s)} {total(counts, kind, s)}
          </Chip>
        ))}
      </nav>

      {items.length === 0 ? (
        <div className="py-20 text-center text-muted">
          <p className="text-xl">这里还空着。</p>
          {root?.owner ? (
            <Link to="/add" className="mt-4 inline-block text-seal underline underline-offset-4">
              记下第一部作品
            </Link>
          ) : null}
        </div>
      ) : (
        <Timeline key={`${kind}:${status}`} first={loaderData} />
      )}
    </>
  );
}

type Page = Route.ComponentProps["loaderData"];

/** Year-grouped cover wall that loads older marks as you scroll down. */
function Timeline({ first }: { first: Page }) {
  const { kind, status, yearCounts } = first;
  const [items, setItems] = useState(first.items);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(first.hasMore);
  const fetcher = useFetcher<Page>();
  const sentinel = useRef<HTMLDivElement>(null);
  const loading = fetcher.state !== "idle";

  useEffect(() => {
    const next = fetcher.data;
    if (fetcher.state !== "idle" || !next || next.page !== page + 1) return;
    setItems((prev) => {
      const seen = new Set(prev.map((i) => i.id));
      return [...prev, ...next.items.filter((i) => !seen.has(i.id))];
    });
    setPage(next.page);
    setHasMore(next.hasMore);
  }, [fetcher.state, fetcher.data, page]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const params = filterParams(kind, status);
    params.set("index", "");
    params.set("page", String(page + 1));
    fetcher.load(`/?${params}`);
  }, [loading, hasMore, kind, status, page, fetcher.load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), {
      rootMargin: "800px 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const byYear = new Map<string, typeof items>();
  for (const item of items) {
    const year = item.marked_on.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), item]);
  }

  return (
    <>
      {[...byYear].map(([year, group]) => (
        <section key={year} className="mb-12">
          <h2 className="mb-5 flex items-baseline gap-3 font-semibold">
            <span className="text-3xl">{year}</span>
            <span className="text-sm text-muted">{yearCounts[year] ?? group.length} 条</span>
          </h2>
          <ul className="grid grid-cols-3 gap-x-4 gap-y-7 sm:grid-cols-4 md:grid-cols-6">
            {group.map((item) => (
              <li key={item.id}>
                <Link to={`/items/${item.id}`} className="group block">
                  <Cover src={item.cover} title={item.title} className="transition group-hover:-translate-y-0.5" />
                  {/* Two lines reserved so the meta line aligns across a row. */}
                  <p className="mt-2 line-clamp-2 h-[3em] text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <span>{item.marked_on.slice(5)}</span>
                    {status ? null : <span>· {statusLabel(item.status, item.kind)}</span>}
                    {item.rating ? <Stars rating={item.rating} /> : null}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div ref={sentinel} className="py-6 text-center text-sm text-muted">
        {hasMore ? (
          <button onClick={loadMore} disabled={loading} className="hover:text-ink">
            {loading ? "加载中…" : "加载更早的标记"}
          </button>
        ) : (
          <span>没有更早的了</span>
        )}
      </div>
    </>
  );
}

function FilterLink({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`border-b-2 pb-1 transition ${active ? "border-seal text-ink" : "border-transparent text-muted hover:text-ink"}`}
    >
      {children}
    </Link>
  );
}

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`rounded-full border px-3 py-1 transition ${active ? "border-ink bg-ink text-paper" : "border-line text-muted hover:border-muted hover:text-ink"}`}
    >
      {children}
    </Link>
  );
}
