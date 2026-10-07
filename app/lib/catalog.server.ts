import { storeCover } from "./covers.server";
import { findBySource, insertItem, type Mark, type NewItem } from "./db.server";
import { isKind, isStatus, type Kind } from "./kinds";
import { searchAll } from "./providers.server";

/**
 * Adding to the shared catalog and validating marks, shared by the web pages
 * and the JSON API so both accept exactly the same input.
 */

type Fields = { get(name: string): unknown };

function text(fields: Fields, name: string) {
  const value = String(fields.get(name) ?? "").trim();
  return value || null;
}

/**
 * A search result the person picked. An item already in the catalog is
 * reused; a new one is read from the source itself, never from fields the
 * client posts, since everyone shares the catalog.
 */
export async function pickItem(
  userId: string,
  kind: Kind,
  source: string | null,
  sourceId: string | null,
  query: string | null,
): Promise<{ id: string } | { error: string }> {
  if (!source || !sourceId || !query) return { error: "条目信息不完整" };
  const existing = await findBySource(source, sourceId);
  if (existing) return { id: existing.id };
  const found = (await searchAll(kind, query))
    .find((group) => group.source === source)
    ?.items.find((candidate) => candidate.source_id === sourceId);
  if (!found) return { error: "没有在来源里找到这个条目，请重新搜索" };
  return { id: await insertItem(found, await storeCover(found.cover_url), userId) };
}

/** A work added by hand when no source has it. */
export async function addManualItem(userId: string, fields: Fields): Promise<{ id: string } | { error: string }> {
  const kind = fields.get("kind");
  if (!isKind(kind)) return { error: "类型无效" };
  const title = text(fields, "title");
  if (!title) return { error: "请填写标题" };
  const coverUrl = text(fields, "cover_url");
  if (coverUrl && !/^https?:\/\//.test(coverUrl)) return { error: "封面需要是 http(s) 链接" };
  const item: NewItem = {
    kind,
    title,
    original_title: text(fields, "original_title"),
    year: Number(fields.get("year")) || null,
    creators: text(fields, "creators"),
    summary: text(fields, "summary"),
    cover_url: coverUrl,
    source: "manual",
    source_id: null,
    source_url: null,
  };
  return { id: await insertItem(item, await storeCover(item.cover_url), userId) };
}

/** A mark from form or JSON fields; ratings only count once a work is started. */
export function parseMark(fields: Fields): { mark: Mark } | { error: string } {
  const status = fields.get("status");
  const markedOn = String(fields.get("marked_on") ?? "");
  const rating = Number(fields.get("rating"));
  const comment = String(fields.get("comment") ?? "").trim();
  if (!isStatus(status) || !/^\d{4}-\d{2}-\d{2}$/.test(markedOn)) return { error: "状态或日期无效" };
  return {
    mark: {
      status,
      rating: status !== "wish" && rating >= 1 && rating <= 5 ? Math.round(rating) : null,
      comment: comment || null,
      marked_on: markedOn,
    },
  };
}
