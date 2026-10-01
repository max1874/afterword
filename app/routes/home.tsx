import { env } from "cloudflare:workers";
import { Link } from "react-router";

import type { Route } from "./+types/home";
import { Cover } from "~/components/cover";
import { Stars } from "~/components/stars";
import { countByKindAndStatus, listMarked } from "~/lib/db.server";
import { coverSrc } from "~/lib/format";
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
  return [{ title: `${loaderData?.ownerName ?? ""}的后记` }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const kind = isKind(params.get("kind")) ? (params.get("kind") as Kind) : undefined;
  const status = isStatus(params.get("status")) ? (params.get("status") as Status) : undefined;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [{ items, hasMore }, counts] = await Promise.all([
    listMarked({ kind, status, page }),
    countByKindAndStatus(),
  ]);
  return {
    ownerName: env.OWNER_NAME || "我",
    kind,
    status,
    page,
    hasMore,
    counts,
    items: items.map((item) => ({ ...item, cover: coverSrc(item) })),
  };
}

function href(kind: Kind | undefined, status: Status | undefined, page = 1) {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

type Counts = Route.ComponentProps["loaderData"]["counts"];

function total(counts: Counts, kind?: Kind, status?: Status) {
  return counts
    .filter((c) => (!kind || c.kind === kind) && (!status || c.status === status))
    .reduce((sum, c) => sum + c.n, 0);
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { ownerName, kind, status, page, hasMore, counts, items } = loaderData;
  const root = useRoot();

  const byYear = new Map<string, typeof items>();
  for (const item of items) {
    const year = item.marked_on.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), item]);
  }

  return (
    <>
      <section className="mb-10 border-b border-line pb-8">
        <h1 className="font-serif text-3xl sm:text-4xl">{ownerName}的后记</h1>
        <p className="mt-3 text-sm text-muted">
          看过 {total(counts, "screen", "done")} 部影视 · 读过 {total(counts, "book", "done")} 本书 ·
          读过 {total(counts, "comic", "done")} 部漫画 · 玩过 {total(counts, "game", "done")} 款游戏
        </p>
      </section>

      <nav className="mb-3 flex flex-wrap gap-x-6 gap-y-2 font-serif text-lg">
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
          <p className="font-serif text-xl">这里还空着。</p>
          {root?.owner ? (
            <Link to="/add" className="mt-4 inline-block text-seal underline underline-offset-4">
              记下第一部作品
            </Link>
          ) : null}
        </div>
      ) : (
        [...byYear].map(([year, group]) => (
          <section key={year} className="mb-12">
            <h2 className="mb-5 flex items-baseline gap-3 font-serif">
              <span className="text-2xl">{year}</span>
              <span className="text-sm text-muted">{group.length} 条</span>
            </h2>
            <ul className="grid grid-cols-3 gap-x-4 gap-y-7 sm:grid-cols-4 md:grid-cols-6">
              {group.map((item) => (
                <li key={item.id}>
                  <Link to={`/items/${item.id}`} className="group block">
                    <Cover
                      src={item.cover}
                      title={item.title}
                      className="transition group-hover:-translate-y-0.5"
                    />
                    <p className="mt-2 line-clamp-2 text-sm leading-snug">{item.title}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      {item.rating ? (
                        <Stars rating={item.rating} />
                      ) : (
                        <span>{statusLabel(item.status, item.kind)}</span>
                      )}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {page > 1 || hasMore ? (
        <nav className="flex justify-between border-t border-line pt-6 text-sm">
          {page > 1 ? <Link to={href(kind, status, page - 1)}>← 较新</Link> : <span />}
          {hasMore ? <Link to={href(kind, status, page + 1)}>更早 →</Link> : <span />}
        </nav>
      ) : null}
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
