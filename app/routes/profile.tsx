import { Link, redirect } from "react-router";

import type { Route } from "./+types/profile";
import { Cover } from "~/components/cover";
import { PageTitle, profileHref } from "~/components/profile-nav";
import { profileFromParam } from "~/lib/accounts.server";
import { countByKindAndStatus, listShelves } from "~/lib/db.server";
import { coverSrc, joinText, monthDay } from "~/lib/format";
import { isKind, KINDS, kindLabel, statusLabel, STATUSES, total, type Kind, type Status } from "~/lib/kinds";
import { getViewer } from "~/lib/session.server";

export const handle = { profileNav: true };

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? joinText(loaderData.profile.name, "的后记") : "后记" }];
}

export async function loader({ request, params: routeParams }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // Filtered lists used to live here; they are in the library now.
  if (url.searchParams.has("status")) throw redirect(`/${routeParams.profile}/library${url.search}`);
  const user = await profileFromParam(routeParams.profile);
  const viewer = await getViewer(request);
  const kind = isKind(url.searchParams.get("kind")) ? (url.searchParams.get("kind") as Kind) : undefined;
  const [shelves, counts] = await Promise.all([listShelves({ userId: user.id, kind }), countByKindAndStatus(user.id)]);
  const withCovers = (items: typeof shelves.done) => items.map((item) => ({ ...item, cover: coverSrc(item) }));
  return {
    profile: { handle: user.handle, name: user.name },
    view: "home" as const,
    mine: viewer?.id === user.id,
    kind,
    counts,
    shelves: { doing: withCovers(shelves.doing), done: withCovers(shelves.done), wish: withCovers(shelves.wish) },
  };
}

type Counts = Route.ComponentProps["loaderData"]["counts"];

function shelfTitle(status: Status, kind?: Kind) {
  const label = kind ? statusLabel(status, kind) : { doing: "进行中", done: "完成", wish: "计划中" }[status];
  return status === "done" ? `最近${label}` : label;
}

export default function ProfileHome({ loaderData }: Route.ComponentProps) {
  const { profile, mine, kind, counts, shelves } = loaderData;
  const empty = STATUSES.every((s) => shelves[s].length === 0);

  return (
    <>
      <PageTitle profile={profile} mine={mine} title={kind ? kindLabel(kind) : "全部"}>
        <Stats counts={counts} kind={kind} />
      </PageTitle>

      {empty ? (
        <div className="py-20 text-center text-muted">
          <p className="text-xl">这里还空着。</p>
          {mine ? (
            <Link to="/add" className="mt-4 inline-block text-ink underline underline-offset-4">
              记下第一部作品
            </Link>
          ) : null}
        </div>
      ) : (
        (["doing", "done", "wish"] as const).map((status) =>
          shelves[status].length ? (
            <Shelf
              key={status}
              title={shelfTitle(status, kind)}
              count={total(counts, kind, status)}
              to={profileHref(profile.handle, "library", { kind, status })}
              items={shelves[status]}
              handle={profile.handle}
            />
          ) : null,
        )
      )}
    </>
  );
}

/** Done counts per kind; within one kind, its count per status. */
function Stats({ counts, kind }: { counts: Counts; kind?: Kind }) {
  const tiles: [number, string][] = kind
    ? STATUSES.map((s) => [total(counts, kind, s), statusLabel(s, kind)])
    : KINDS.map((k) => [total(counts, k, "done"), `${statusLabel("done", k)}的${kindLabel(k)}`]);
  return (
    <dl className="grid w-full grid-cols-4 gap-2 sm:flex sm:w-auto sm:gap-3">
      {tiles.map(([n, label]) => (
        <div key={label} className="rounded-2xl bg-card px-3 py-2.5 sm:min-w-28 sm:px-5 sm:py-3.5">
          <dd className="text-[22px] leading-tight font-bold tracking-[-0.02em] sm:text-[28px]">{n}</dd>
          <dt className="text-[11px] text-muted sm:text-[13px]">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

type ShelfItem = Route.ComponentProps["loaderData"]["shelves"]["done"][number];

/** One row of covers that scrolls sideways; the title opens the full list. */
function Shelf({ title, count, to, items, handle }: { title: string; count: number; to: string; items: ShelfItem[]; handle: string }) {
  return (
    <section className="mt-9">
      <h2 className="mb-3.5">
        <Link to={to} className="inline-flex items-center gap-1.5 text-[22px] font-bold hover:opacity-70">
          {title}
          <span className="ml-0.5 text-[15px] font-medium text-muted">{count}</span>
          <svg viewBox="0 0 24 24" className="size-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </h2>
      {/* Bleeds to the screen edge on phones so the next cover peeks in. */}
      <ul className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:gap-5 sm:px-6">
        {items.map((item) => (
          <li key={item.id} className="w-[104px] shrink-0 snap-start sm:w-[148px]">
            <Link to={`/@${handle}/items/${item.id}`} className="group block">
              <Cover src={item.cover} title={item.title} className="transition group-hover:-translate-y-0.5" />
              <p className="mt-2 truncate text-xs font-semibold sm:text-[13px]">{item.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted sm:text-xs">
                {statusLabel(item.status, item.kind)} · {monthDay(item.marked_on)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
