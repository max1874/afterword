import { Link, redirect } from "react-router";

import type { Route } from "./+types/profile";
import { Cover } from "~/components/cover";
import { PageTitle, profileHref } from "~/components/profile-nav";
import { WideCard } from "~/components/wide-card";
import { profileFromParam } from "~/lib/accounts.server";
import { fillDetails } from "~/lib/details.server";
import { countByKindAndStatus, listShelves } from "~/lib/db.server";
import { backdropSrc, coverSrc, joinText, monthDay } from "~/lib/format";
import { KINDS, kindLabel, statusLabel, total, type Kind, type Status } from "~/lib/kinds";
import { getViewer } from "~/lib/session.server";

export const handle = { profileNav: true };

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? joinText(loaderData.profile.name, "的后记") : "后记" }];
}

export async function loader({ request, params: routeParams }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // Filtered lists live in the library.
  if (url.searchParams.has("status") || url.searchParams.has("kind")) {
    throw redirect(`/${routeParams.profile}/library${url.search}`);
  }
  const user = await profileFromParam(routeParams.profile);
  const viewer = await getViewer(request);
  const [shelves, counts] = await Promise.all([listShelves({ userId: user.id }), countByKindAndStatus(user.id)]);
  fillDetails(shelves.doing);
  const withArt = (items: typeof shelves.done) =>
    items.map((item) => ({ ...item, cover: coverSrc(item), backdrop: backdropSrc(item) }));
  return {
    profile: { handle: user.handle, name: user.name },
    view: "home" as const,
    mine: viewer?.id === user.id,
    counts,
    shelves: { doing: withArt(shelves.doing), done: withArt(shelves.done), wish: withArt(shelves.wish) },
  };
}

type Counts = Route.ComponentProps["loaderData"]["counts"];
type ShelfItem = Route.ComponentProps["loaderData"]["shelves"]["done"][number];

export default function ProfileHome({ loaderData }: Route.ComponentProps) {
  const { profile, mine, counts, shelves } = loaderData;
  const { handle } = profile;
  const empty = !shelves.doing.length && !shelves.done.length && !shelves.wish.length;

  return (
    <>
      <PageTitle profile={profile} mine={mine} title="首页" />

      {empty ? (
        <div className="py-20 text-center text-muted">
          <p className="text-xl">这里还空着。</p>
          {mine ? (
            <Link to="/add" className="mt-4 inline-block text-accent">
              记下第一部作品
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          {shelves.doing.length ? (
            <Row title="进行中" count={total(counts, undefined, "doing")} to={profileHref(handle, "library", { status: "doing" })}>
              {shelves.doing.map((item) => (
                <li key={item.id} className="w-[300px] shrink-0 snap-start sm:w-[380px]">
                  <WideCard item={item} href={`/@${handle}/items/${item.id}`} />
                </li>
              ))}
            </Row>
          ) : null}

          <Row title="分类" to={profileHref(handle, "library", {})}>
            <KindTiles counts={counts} handle={handle} />
          </Row>

          {(["done", "wish"] as const).map((status) =>
            shelves[status].length ? (
              <Row
                key={status}
                title={status === "done" ? "最近完成" : "计划中"}
                count={total(counts, undefined, status)}
                to={profileHref(handle, "library", { status })}
              >
                {shelves[status].map((item) => (
                  <PosterCard key={item.id} item={item} handle={handle} status={status} />
                ))}
              </Row>
            ) : null,
          )}
        </>
      )}
    </>
  );
}

/** A titled row that scrolls sideways, with 查看全部 on the right as in Infuse. */
function Row({ title, count, to, children }: { title: string; count?: number; to: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-baseline justify-between">
        <span className="text-[22px] font-bold">
          {title}
          {count !== undefined ? <span className="ml-2 text-[15px] font-medium text-muted">{count}</span> : null}
        </span>
        <Link to={to} className="text-[15px] font-medium text-accent hover:opacity-75">
          查看全部
        </Link>
      </h2>
      {/* Bleeds to the screen edge on phones so the next card peeks in. */}
      <ul className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:gap-5 sm:px-6">
        {children}
      </ul>
    </section>
  );
}

const TILE_COLOURS: Record<Kind | "all", string> = {
  all: "from-[#8e8e93] to-[#48484a]",
  screen: "from-[#0a84ff] to-[#5e5ce6]",
  book: "from-[#ff9f0a] to-[#ff6a00]",
  comic: "from-[#ff375f] to-[#bf5af2]",
  game: "from-[#30d158] to-[#00a5b8]",
};

/** Bright tiles into the library by kind, like Infuse's Favorites. */
function KindTiles({ counts, handle }: { counts: Counts; handle: string }) {
  const tiles: [Kind | "all", string, number][] = [
    ["all", "全部", total(counts)],
    ...KINDS.map((k): [Kind, string, number] => [k, kindLabel(k), total(counts, k)]),
  ];
  return tiles.map(([key, label, n]) => (
    <li key={key} className="w-[112px] shrink-0 snap-start sm:w-[168px]">
      <Link to={profileHref(handle, "library", { kind: key === "all" ? undefined : key })} className="group block">
        <div
          className={`relative grid h-[68px] place-items-center rounded-2xl bg-gradient-to-br text-white transition group-hover:-translate-y-0.5 sm:h-[84px] ${TILE_COLOURS[key]}`}
        >
          <KindIcon kind={key} />
          <span className="absolute top-1.5 right-2.5 text-xs font-bold opacity-90">{n}</span>
        </div>
        <p className="mt-1.5 text-[13px] font-medium">{label}</p>
      </Link>
    </li>
  ));
}

function KindIcon({ kind }: { kind: Kind | "all" }) {
  const paths: Record<Kind | "all", React.ReactNode> = {
    all: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </>
    ),
    screen: (
      <>
        <rect x="3" y="5" width="18" height="12" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
    book: <path d="M4 5.5C6.5 4 9.5 4 12 5.5v14C9.5 18 6.5 18 4 19.5zM20 5.5C17.5 4 14.5 4 12 5.5v14c2.5-1.5 5.5-1.5 8 0z" />,
    comic: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M4 11h16M12 11v10" />
      </>
    ),
    game: (
      <>
        <path d="M7 8h10a4 4 0 0 1 4 4.5l-.6 3.4a2.5 2.5 0 0 1-4.3 1.3L14.5 15h-5l-1.6 2.2a2.5 2.5 0 0 1-4.3-1.3L3 12.5A4 4 0 0 1 7 8z" />
        <path d="M8 11v3M6.5 12.5h3" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" className="size-8 sm:size-9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[kind]}
    </svg>
  );
}

function PosterCard({ item, handle, status }: { item: ShelfItem; handle: string; status: Status }) {
  return (
    <li className="w-[104px] shrink-0 snap-start sm:w-[148px]">
      <Link to={`/@${handle}/items/${item.id}`} className="group block">
        <Cover src={item.cover} title={item.title} className="transition group-hover:-translate-y-0.5" />
        <p className="mt-2 truncate text-[13px]">{item.title}</p>
        <p className="truncate text-xs text-muted">
          {status === "done" ? statusLabel(item.status, item.kind) : kindLabel(item.kind)} · {monthDay(item.marked_on)}
        </p>
      </Link>
    </li>
  );
}
