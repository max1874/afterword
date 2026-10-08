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
  KINDS,
  kindLabel,
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
  const until = Number(params.get("until")) || undefined;
  const [{ items, hasMore }, counts, yearCounts] = await Promise.all([
    listMarked({ userId: user.id, kind, status, until, page }),
    countByKindAndStatus(user.id),
    countByYear({ userId: user.id, kind, status }),
  ]);
  return {
    profile: { handle: user.handle, name: user.name },
    view: "library" as const,
    mine: viewer?.id === user.id,
    kind,
    status,
    until,
    page,
    hasMore,
    counts,
    yearCounts,
    items: items.map((item) => ({ ...item, cover: coverSrc(item) })),
  };
}

export default function Library({ loaderData }: Route.ComponentProps) {
  const { profile, mine, kind, status, until, counts, items, yearCounts } = loaderData;
  const { handle } = profile;
  const years = Object.keys(yearCounts).sort().reverse();

  return (
    <>
      <PageTitle profile={profile} mine={mine} title="资料库" />
      <div className="mt-4 mb-8 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-3">
        <Segmented
          items={[[undefined, "全部"], ...KINDS.map((k): [Kind, string] => [k, kindLabel(k)])]}
          active={kind}
          href={(k) => profileHref(handle, "library", { kind: k, status })}
        />
        <Segmented
          items={[[undefined, `全部 ${total(counts, kind)}`], ...STATUSES.map((s): [Status, string] => [s, `${kind ? statusLabel(s, kind) : genericStatusLabel(s)} ${total(counts, kind, s)}`])]}
          active={status}
          href={(s) => profileHref(handle, "library", { kind, status: s })}
        />
      </div>

      {items.length === 0 ? (
        <div className="py-20 text-center text-muted">
          <p className="text-xl">这里还空着。</p>
          {mine ? (
            <Link to="/add" className="mt-4 inline-block text-accent">
              记下第一部作品
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="relative">
          <Timeline key={`${handle}:${kind}:${status}:${until}`} first={loaderData} />
          {years.length > 1 ? (
            /* Jump to a year, like Infuse's letter index down the side. */
            <nav className="fixed top-1/2 right-1 z-10 flex -translate-y-1/2 flex-col items-center gap-0.5 text-[11px] font-bold text-accent sm:right-3">
              {years.map((y) => (
                <Link
                  key={y}
                  to={profileHref(handle, "library", { kind, status, until: Number(y) })}
                  className={`rounded px-1 py-px leading-tight ${until === Number(y) ? "bg-accent text-accent-ink" : "hover:opacity-70"}`}
                >
                  {y.slice(2)}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      )}
    </>
  );
}

function Segmented<T extends string>({
  items,
  active,
  href,
}: {
  items: [T | undefined, string][];
  active: T | undefined;
  href: (value: T | undefined) => string;
}) {
  return (
    <nav className="flex overflow-x-auto rounded-full bg-card p-1 text-sm font-semibold [scrollbar-width:none] sm:inline-flex">
      {items.map(([value, label]) => (
        <Link
          key={label}
          to={href(value)}
          className={`shrink-0 rounded-full px-3.5 py-1.5 whitespace-nowrap transition ${active === value ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

type Page = Route.ComponentProps["loaderData"];

/** Year-grouped cover wall that loads older marks as you scroll down. */
function Timeline({ first }: { first: Page }) {
  const { kind, status, until, yearCounts } = first;
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
    const href = profileHref(handle, "library", { kind, status, until });
    fetcher.load(`${href}${href.includes("?") ? "&" : "?"}page=${page + 1}`);
  }, [loading, hasMore, handle, kind, status, until, page, fetcher.load]);

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
          <ul className="grid grid-cols-3 gap-x-3 gap-y-6 pr-5 sm:grid-cols-5 sm:gap-x-5 md:grid-cols-7">
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
