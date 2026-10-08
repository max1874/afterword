import { Link, useMatches } from "react-router";

import type { Kind } from "~/lib/kinds";

/** Route data a person's pages share, so the header can switch kinds and views for them. */
export type ProfileNavData = { profile: { handle: string; name: string }; view: "home" | "library" };

export function useProfileNav() {
  const match = useMatches().find((m) => (m.handle as { profileNav?: boolean } | undefined)?.profileNav);
  return match?.loaderData as ProfileNavData | undefined;
}

export function profileHref(handle: string, view: "home" | "library", params: { kind?: Kind; status?: string; until?: number }) {
  const query = new URLSearchParams();
  if (params.kind) query.set("kind", params.kind);
  if (params.status) query.set("status", params.status);
  if (params.until) query.set("until", String(params.until));
  const base = view === "home" ? `/@${handle}` : `/@${handle}/library`;
  return query.size ? `${base}?${query}` : base;
}

/** 首页 / 资料库 for the person whose pages these are, as one glass capsule. */
export function ProfileNav({ handle, view }: { handle: string; view?: "home" | "library" }) {
  const tabs: ["home" | "library", string][] = [
    ["home", "首页"],
    ["library", "资料库"],
  ];
  return (
    <nav className="flex rounded-full bg-card/80 p-1 text-sm font-semibold shadow-[inset_0_0_0_0.5px_rgba(127,127,127,0.3)] backdrop-blur">
      {tabs.map(([v, label]) => (
        <Link
          key={v}
          to={profileHref(handle, v, {})}
          className={`rounded-full px-4 py-1.5 transition ${view === v ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
        >
          {label}
        </Link>
      ))}
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
