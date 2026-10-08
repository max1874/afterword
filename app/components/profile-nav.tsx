import { Link, useMatches, useSearchParams } from "react-router";

import { isKind, KINDS, kindLabel, type Kind } from "~/lib/kinds";

/** Route data a person's pages share, so the header can switch kinds and views for them. */
export type ProfileNavData = { profile: { handle: string; name: string }; view: "home" | "library" };

export function useProfileNav() {
  const match = useMatches().find((m) => (m.handle as { profileNav?: boolean } | undefined)?.profileNav);
  return match?.loaderData as ProfileNavData | undefined;
}

export function profileHref(handle: string, view: "home" | "library", params: { kind?: Kind; status?: string }) {
  const query = new URLSearchParams();
  if (params.kind) query.set("kind", params.kind);
  if (params.status) query.set("status", params.status);
  const base = view === "home" ? `/@${handle}` : `/@${handle}/library`;
  return query.size ? `${base}?${query}` : base;
}

/** 全部 / 影视 / 书 / 漫画 / 游戏, kept on the current page; plus the way between shelves and library. */
export function ProfileNav({ data }: { data: ProfileNavData }) {
  const [params] = useSearchParams();
  const kind = isKind(params.get("kind")) ? (params.get("kind") as Kind) : undefined;
  const status = data.view === "library" ? (params.get("status") ?? undefined) : undefined;
  const { handle } = data.profile;
  const segments: [Kind | undefined, string][] = [[undefined, "全部"], ...KINDS.map((k): [Kind, string] => [k, kindLabel(k)])];

  return (
    <nav className="flex items-center gap-2 overflow-x-auto text-[13px] font-medium [scrollbar-width:none]">
      <div className="flex shrink-0 rounded-[10px] bg-card p-[3px]">
        {segments.map(([k, label]) => (
          <Link
            key={label}
            to={profileHref(handle, data.view, { kind: k, status })}
            className={`rounded-[8px] px-3 py-[5px] transition sm:px-4 ${kind === k ? "bg-paper shadow-[0_1px_3px_rgba(0,0,0,0.12)] dark:bg-line" : "hover:text-muted"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <Link
        to={profileHref(handle, data.view === "home" ? "library" : "home", { kind })}
        className={`shrink-0 rounded-[10px] px-3 py-[8px] transition sm:px-4 ${data.view === "library" ? "bg-ink text-paper" : "bg-card hover:text-muted"}`}
      >
        资料库
      </Link>
    </nav>
  );
}

/** The page's large title; on someone else's page, whose page it is goes above it. */
export function PageTitle({
  profile,
  mine,
  title,
  children,
}: {
  profile: { handle: string; name: string };
  mine: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="mb-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div>
        {mine ? null : (
          <p className="mb-1 text-[15px] font-medium text-muted">
            {profile.name} · @{profile.handle}
          </p>
        )}
        <h1 className="text-[34px] leading-tight font-bold tracking-[-0.02em] sm:text-[48px]">{title}</h1>
      </div>
      {children}
    </section>
  );
}
