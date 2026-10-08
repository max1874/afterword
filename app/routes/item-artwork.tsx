import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/item-artwork";
import { profileFromParam } from "~/lib/accounts.server";
import { getItem } from "~/lib/db.server";
import { artworkChoices, chooseArtwork, hasArtwork } from "~/lib/details.server";
import { getViewer } from "~/lib/session.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `更换横图 · ${loaderData.item.title} · 后记` : "后记" }];
}

/** Items are a shared catalog, so only an admin replaces their artwork. */
async function load(request: Request, params: Route.LoaderArgs["params"]) {
  const user = await profileFromParam(params.profile);
  const viewer = await getViewer(request);
  if (!viewer?.is_admin) throw data(null, { status: 403 });
  const item = await getItem(params.id, user.id);
  if (!item || !hasArtwork(item)) throw data(null, { status: 404 });
  return { user, item };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, item } = await load(request, params);
  return {
    item: { title: item.title, backdrop_url: item.backdrop_url },
    back: `/@${user.handle}/items/${item.id}`,
    choices: await artworkChoices(item),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, item } = await load(request, params);
  const url = (await request.formData()).get("url");
  const result = await chooseArtwork(item, typeof url === "string" && url ? url : null);
  if ("error" in result) return data({ error: result.error }, { status: 400 });
  return redirect(`/@${user.handle}/items/${item.id}`);
}

export default function ItemArtwork({ loaderData, actionData }: Route.ComponentProps) {
  const { item, back, choices } = loaderData;
  const navigation = useNavigation();
  const pending = navigation.formData?.get("url");

  return (
    <div>
      <p className="text-sm">
        <Link to={back} className="text-muted hover:text-ink">
          ← {item.title}
        </Link>
      </p>
      <h1 className="mt-2 text-[28px] font-extrabold tracking-[-0.01em]">更换横图</h1>
      <p className="mt-1 text-[15px] text-muted">从 TMDB、Steam、IGDB 和 SteamGridDB 找到的图里挑一张。</p>
      {actionData && "error" in actionData ? <p className="mt-4 text-sm text-danger">{actionData.error}</p> : null}

      <Form method="post" className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {choices.map((choice) => {
          const current = choice.url === item.backdrop_url;
          return (
            <button
              key={choice.url}
              name="url"
              value={choice.url}
              disabled={pending != null}
              className={`group relative aspect-video overflow-hidden rounded-2xl bg-card text-left transition disabled:opacity-60 ${current ? "ring-3 ring-ink" : "hover:opacity-85"}`}
            >
              <img src={choice.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
              <span className="absolute bottom-2 left-2 rounded-full bg-black/45 px-2.5 py-0.5 text-xs font-semibold text-white backdrop-blur">
                {pending === choice.url ? "保存中…" : current ? `当前 · ${choice.source}` : choice.source}
              </span>
            </button>
          );
        })}
        <button
          name="url"
          value=""
          disabled={pending != null}
          className={`flex aspect-video items-center justify-center rounded-2xl border border-dashed border-line text-[15px] text-muted transition hover:text-ink disabled:opacity-60 ${item.backdrop_url ? "" : "ring-3 ring-ink"}`}
        >
          {pending === "" ? "保存中…" : "不用横图，显示封面"}
        </button>
      </Form>
      {choices.length ? null : <p className="mt-4 text-[15px] text-muted">各来源都没有找到这部作品的横图。</p>}
    </div>
  );
}
