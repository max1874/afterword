import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";

import type { Route } from "./+types/profile";
import { Cover } from "~/components/cover";
import { Stars } from "~/components/stars";
import { profileFromParam } from "~/lib/accounts.server";
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
import { getViewer } from "~/lib/session.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? joinText(loaderData.profile.name, "的后记") : "后记" }];
}

export async function loader({ request, params: routeParams }: Route.LoaderArgs) {
  const user = await profileFromParam(routeParams.profile);
  const viewer = await getViewer(request);
  const params = new URL(request.url).searchParams;
  const kind = isKind(params.get("kind")) ? (params.get("kind") as Kind) : undefined;
  const status = isStatus(params.get("status")) ? (params.get("status") as Status) : undefined;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [{ items, hasMore }, counts, yearCounts] = await Promise.all([
    listMarked({ userId: user.id, kind, status, page }),
    countByKindAndStatus(user.id),
    countByYear({ userId: user.id, kind, status }),
  ]);
  return {
    profile: { handle: user.handle, name: user.name },
    mine: viewer?.id === user.id,
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

function href(handle: string, kind: Kind | undefined, status: Status | undefined) {
  const query = filterParams(kind, status).toString();
  return query ? `/@${handle}?${query}` : `/@${handle}`;
}

type Counts = Route.ComponentProps["loaderData"]["counts"];

function total(counts: Counts, kind?: Kind, status?: Status) {
  return counts
    .filter((c) => (!kind || c.kind === kind) && (!status || c.status === status))
    .reduce((sum, c) => sum + c.n, 0);
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { profile, mine, kind, status, counts, items } = loaderData;
  const { handle } = profile;

  return (
    <>
      <section className="mb-10 border-b border-line pb-8">
        <h1 className="text-3xl font-semibold sm:text-4xl">{joinText(profile.name, "的后记")}</h1>
        <p className="mt-3 text-xl font-semibold text-muted">
          看过 {total(counts, "screen", "done")} 部影视 · 读过 {total(counts, "book", "done")} 本书 ·
          读过 {total(counts, "comic", "done")} 部漫画 · 玩过 {total(counts, "game", "done")} 款游戏
        </p>
      </section>

      <nav className="mb-3 flex flex-wrap gap-x-6 gap-y-2 text-lg font-semibold">
        <FilterLink to={href(handle, undefined, status)} active={!kind}>
          全部
        </FilterLink>
        {KINDS.map((k) => (
          <FilterLink key={k} to={href(handle, k, status)} active={kind === k}>
            {kindLabel(k)}
            <sup className="ml-0.5 font-sans text-xs text-muted">{total(counts, k)}</sup>
          </FilterLink>
        ))}
      </nav>
      <nav className="mb-10 flex flex-wrap gap-2 text-sm">
        <Chip to={href(handle, kind, undefined)} active={!status}>
          全部
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} to={href(handle, kind, s)} active={status === s}>
            {kind ? statusLabel(s, kind) : genericStatusLabel(s)} {total(counts, kind, s)}
          </Chip>
        ))}
      </nav>

      {items.length === 0 ? (
        <div className="py-20 text-center text-muted">
          <p className="text-xl">这里还空着。</p>
          {mine ? (
            <Link to="/add" className="mt-4 inline-block text-seal underline underline-offset-4">
              记下第一部作品
            </Link>
          ) : null}
        </div>
      ) : (
        <Timeline key={`${handle}:${kind}:${status}`} first={loaderData} />
      )}
    </>
  );
}

type Page = Route.ComponentProps["loaderData"];

/** Year-grouped cover wall that loads older marks as you scroll down. */
function Timeline({ first }: { first: Page }) {
  const { kind, status, yearCounts } = first;
  const { handle } = first.profile;
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
    params.set("page", String(page + 1));
    fetcher.load(`/@${handle}?${params}`);
  }, [loading, hasMore, handle, kind, status, page, fetcher.load]);

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
                <Link to={`/@${handle}/items/${item.id}`} className="group block">
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
