import { Link } from "react-router";

import { monthDay } from "~/lib/format";
import { kindLabel, statusLabel, type Kind, type Status } from "~/lib/kinds";

export type WideCardItem = {
  id: string;
  kind: Kind;
  title: string;
  original_title: string | null;
  year: number | null;
  status: Status;
  marked_on: string;
  cover: string | null;
  backdrop: string | null;
};

/**
 * A 16:9 card for what is in progress. Landscape artwork fills it when there
 * is some; otherwise the cover stands on the left over a wash of its own
 * colours, with the title beside it.
 */
export function WideCard({ item, href }: { item: WideCardItem; href: string }) {
  return (
    <Link to={href} className="group block">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-card shadow-[inset_0_0_0_0.5px_rgba(127,127,127,0.25)] transition group-hover:-translate-y-0.5">
        {item.backdrop ? (
          <img src={item.backdrop} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : item.cover ? (
          <>
            <img
              src={item.cover}
              alt=""
              aria-hidden
              referrerPolicy="no-referrer"
              className="absolute -inset-10 size-[calc(100%+5rem)] max-w-none object-fill blur-[50px] brightness-[0.62] saturate-[1.35]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/5 from-30% to-black/35" />
            <img
              src={item.cover}
              alt=""
              referrerPolicy="no-referrer"
              className="absolute top-[8%] bottom-[8%] left-[4.5%] aspect-[2/3] h-[84%] rounded-lg object-cover shadow-[0_14px_30px_rgba(0,0,0,0.45),0_0_0_0.5px_rgba(255,255,255,0.15)]"
            />
            <div className="absolute top-[10%] right-[5%] left-[44%] text-white">
              <p className="line-clamp-3 text-[clamp(15px,1.6vw,22px)] leading-tight font-bold">{item.title}</p>
              <p className="mt-1.5 line-clamp-2 text-xs text-white/70">
                {[item.original_title, kindLabel(item.kind), item.year].filter(Boolean).join(" · ")}
              </p>
            </div>
          </>
        ) : null}
        <span className="absolute right-3 bottom-3 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-white shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.2)] backdrop-blur-md">
          {statusLabel(item.status, item.kind)}
        </span>
      </div>
      <p className="mt-2.5 truncate text-[15px] font-semibold">{item.title}</p>
      <p className="truncate text-[13px] text-muted">
        {kindLabel(item.kind)} · {monthDay(item.marked_on)} 起
      </p>
    </Link>
  );
}
