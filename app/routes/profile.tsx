import { Link, redirect } from "react-router";

import type { Route } from "./+types/profile";
import { Cover } from "~/components/cover";
import { PageTitle, profileHref } from "~/components/profile-nav";
import { WideCard } from "~/components/wide-card";
import { profileFromParam } from "~/lib/accounts.server";
import { fillDetails } from "~/lib/details.server";
import { countByKindAndStatus, listShelves, tileCovers } from "~/lib/db.server";
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
  const [shelves, counts, tiles] = await Promise.all([
    listShelves({ userId: user.id }),
    countByKindAndStatus(user.id),
    tileCovers(user.id),
  ]);
  fillDetails(shelves.doing);
  const withArt = (items: typeof shelves.done) =>
    items.map((item) => ({ ...item, cover: coverSrc(item), backdrop: backdropSrc(item) }));
  return {
    profile: { handle: user.handle, name: user.name },
    view: "home" as const,
    mine: viewer?.id === user.id,
    counts,
    tiles,
    shelves: { doing: withArt(shelves.doing), done: withArt(shelves.done), wish: withArt(shelves.wish) },
  };
}

type ShelfItem = Route.ComponentProps["loaderData"]["shelves"]["done"][number];

export default function ProfileHome({ loaderData }: Route.ComponentProps) {
  const { profile, mine, counts, tiles, shelves } = loaderData;
  const { handle } = profile;
  const empty = !shelves.doing.length && !shelves.done.length && !shelves.wish.length;

  return (
    <>
      <PageTitle profile={profile} mine={mine} title="首页" />

      {empty ? (
        <div className="py-20 text-center text-muted">
          <p className="text-xl">这里还空着。</p>
          {mine ? (
            <Link to="/add" className="mt-4 inline-block text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
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
            <KindTiles handle={handle} covers={tiles} />
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
        <Link to={to} className="text-[15px] font-medium text-muted hover:text-ink">
          查看全部 ›
        </Link>
      </h2>
      {/* Bleeds to the screen edge on phones so the next card peeks in. */}
      <ul className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:gap-5 sm:px-6">
        {children}
      </ul>
    </section>
  );
}

/** Tiles into the library by kind, like Infuse's Favorites: that kind's latest covers side by side. */
function KindTiles({ handle, covers }: { handle: string; covers: Record<Kind | "all", string[]> }) {
  const tiles: [Kind | "all", string][] = [["all", "全部"], ...KINDS.map((k): [Kind, string] => [k, kindLabel(k)])];
  return tiles.map(([key, label]) => (
    <li key={key} className="w-[112px] shrink-0 snap-start sm:w-[168px]">
      <Link to={profileHref(handle, "library", { kind: key === "all" ? undefined : key })} className="group block">
        <div className="relative h-[68px] overflow-hidden rounded-2xl bg-card shadow-[inset_0_0_0_0.5px_rgba(127,127,127,0.25)] transition group-hover:-translate-y-0.5 sm:h-[84px]">
          <div aria-hidden className="absolute inset-0 flex">
            {covers[key].map((src) => (
              <img key={src} src={src} alt="" referrerPolicy="no-referrer" className="h-full min-w-0 flex-1 object-cover" />
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-[13px] font-medium">{label}</p>
      </Link>
    </li>
  ));
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
