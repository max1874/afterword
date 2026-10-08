import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";

import type { Route } from "./+types/library";
import { Cover } from "~/components/cover";
import { PageTitle, profileHref } from "~/components/profile-nav";
import { Stars } from "~/components/stars";
import { profileFromParam } from "~/lib/accounts.server";
import { countByKindAndStatus, countByYear, listMarked } from "~/lib/db.server";
import { coverSrc, joinText, monthDay } from "~/lib/format";
import {
  genericStatusLabel,
  isKind,
  isStatus,
  STATUSES,
  statusLabel,
  total,
  type Kind,
  type Status,
} from "~/lib/kinds";
import { getViewer } from "~/lib/session.server";

export const handle = { profileNav: true };

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `资料库 · ${joinText(loaderData.profile.name, "的后记")}` : "后记" }];
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
    view: "library" as const,
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

export default function Library({ loaderData }: Route.ComponentProps) {
  const { profile, mine, kind, status, counts, items } = loaderData;
  const { handle } = profile;

  return (
    <>
      <PageTitle profile={profile} mine={mine} title="资料库" />
      <nav className="mt-4 mb-9 flex flex-wrap gap-2 text-sm">
        <Chip to={profileHref(handle, "library", { kind })} active={!status}>
          全部 {total(counts, kind)}
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} to={profileHref(handle, "library", { kind, status: s })} active={status === s}>
            {kind ? statusLabel(s, kind) : genericStatusLabel(s)} {total(counts, kind, s)}
          </Chip>
        ))}
      </nav>

      {items.length === 0 ? (
        <div className="py-20 text-center text-muted">
          <p className="text-xl">这里还空着。</p>
          {mine ? (
            <Link to="/add" className="mt-4 inline-block text-ink underline underline-offset-4">
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
    const href = profileHref(handle, "library", { kind, status });
    fetcher.load(`${href}${href.includes("?") ? "&" : "?"}page=${page + 1}`);
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
          <h2 className="mb-5 flex items-baseline gap-2 border-b border-line pb-3 font-bold">
            <span className="text-[22px]">{year}</span>
            <span className="text-[13px] font-medium text-muted">{yearCounts[year] ?? group.length} 条</span>
          </h2>
          <ul className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-5 sm:gap-x-5 md:grid-cols-7">
            {group.map((item) => (
              <li key={item.id} className="min-w-0">
                <Link to={`/@${handle}/items/${item.id}`} className="group block">
                  <Cover src={item.cover} title={item.title} className="transition group-hover:-translate-y-0.5" />
                  <p className="mt-2 truncate text-[13px] font-medium">{item.title}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                    <span>{status ? monthDay(item.marked_on) : `${statusLabel(item.status, item.kind)} · ${monthDay(item.marked_on)}`}</span>
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

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`rounded-full px-3.5 py-1.5 transition ${active ? "bg-ink text-paper" : "bg-card text-ink hover:text-muted"}`}
    >
      {children}
    </Link>
  );
}
