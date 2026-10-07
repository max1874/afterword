import { env } from "cloudflare:workers";

import type { Kind, Status } from "./kinds";

export type Item = {
  id: string;
  kind: Kind;
  title: string;
  original_title: string | null;
  year: number | null;
  creators: string | null;
  summary: string | null;
  cover_key: string | null;
  cover_url: string | null;
  source: string;
  source_id: string | null;
  source_url: string | null;
};

export type Mark = {
  status: Status;
  rating: number | null;
  comment: string | null;
  marked_on: string;
};

export type MarkedItem = Item & Mark;

export type NewItem = Omit<Item, "id" | "cover_key">;

export const PAGE_SIZE = 48;

export function newId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

export function today() {
  // Dates are stored as the owner's calendar day; China Standard Time by default.
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

type MarkFilter = { kind?: Kind; status?: Status };

function whereClause(filter: MarkFilter) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.kind) {
    where.push("i.kind = ?");
    params.push(filter.kind);
  }
  if (filter.status) {
    where.push("m.status = ?");
    params.push(filter.status);
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

/** Marks per year for the filter, so year headings stay right while pages load. */
export async function countByYear(filter: MarkFilter) {
  const { clause, params } = whereClause(filter);
  const { results } = await env.DB.prepare(
    `SELECT substr(m.marked_on, 1, 4) AS mark_year, COUNT(*) AS n
     FROM marks m JOIN items i ON i.id = m.item_id
     ${clause}
     GROUP BY mark_year`,
  )
    .bind(...params)
    .all<{ mark_year: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.mark_year, r.n]));
}

export async function listMarked(filter: MarkFilter & { page: number }) {
  const { clause, params } = whereClause(filter);
  const { results } = await env.DB.prepare(
    `SELECT i.*, m.status, m.rating, m.comment, m.marked_on
     FROM marks m JOIN items i ON i.id = m.item_id
     ${clause}
     ORDER BY m.marked_on DESC, m.marked_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...params, PAGE_SIZE + 1, (filter.page - 1) * PAGE_SIZE)
    .all<MarkedItem>();
  return { items: results.slice(0, PAGE_SIZE), hasMore: results.length > PAGE_SIZE };
}

export async function countByKindAndStatus() {
  const { results } = await env.DB.prepare(
    `SELECT i.kind, m.status, COUNT(*) AS n
     FROM marks m JOIN items i ON i.id = m.item_id
     GROUP BY i.kind, m.status`,
  ).all<{ kind: Kind; status: Status; n: number }>();
  return results;
}

export async function getItem(id: string) {
  return env.DB.prepare(
    `SELECT i.*, m.status, m.rating, m.comment, m.marked_on
     FROM items i LEFT JOIN marks m ON m.item_id = i.id
     WHERE i.id = ?`,
  )
    .bind(id)
    .first<Item & Partial<Mark>>();
}

export async function findBySource(source: string, sourceId: string) {
  return env.DB.prepare("SELECT id, cover_key FROM items WHERE source = ? AND source_id = ?")
    .bind(source, sourceId)
    .first<{ id: string; cover_key: string | null }>();
}

export async function setCoverKey(id: string, coverKey: string) {
  await env.DB.prepare("UPDATE items SET cover_key = ? WHERE id = ?").bind(coverKey, id).run();
}

/** Marks already recorded for the given source ids, so search results can show them. */
export async function markedSourceIds(source: string, sourceIds: string[]) {
  if (sourceIds.length === 0) return new Map<string, string>();
  const { results } = await env.DB.prepare(
    `SELECT source_id, id FROM items
     WHERE source = ? AND source_id IN (${sourceIds.map(() => "?").join(",")})`,
  )
    .bind(source, ...sourceIds)
    .all<{ source_id: string; id: string }>();
  return new Map(results.map((r) => [r.source_id, r.id]));
}

export async function insertItem(item: NewItem, coverKey: string | null) {
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO items (id, kind, title, original_title, year, creators, summary,
       cover_key, cover_url, source, source_id, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      item.kind,
      item.title,
      item.original_title,
      item.year,
      item.creators,
      item.summary,
      coverKey,
      item.cover_url,
      item.source,
      item.source_id,
      item.source_url,
    )
    .run();
  return id;
}

/**
 * Saves a mark. `markedAt` orders marks within the same day; imports pass the
 * source's order, edits keep the existing position unless the date changes.
 */
export async function saveMark(itemId: string, mark: Mark, markedAt?: string) {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  await env.DB.prepare(
    `INSERT INTO marks (item_id, status, rating, comment, marked_on, marked_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (item_id) DO UPDATE SET
       status = excluded.status, rating = excluded.rating, comment = excluded.comment,
       marked_on = excluded.marked_on,
       marked_at = CASE WHEN ?8 = 0 AND marks.marked_on = excluded.marked_on
         THEN marks.marked_at ELSE excluded.marked_at END,
       updated_at = excluded.updated_at`,
  )
    .bind(itemId, mark.status, mark.rating, mark.comment, mark.marked_on, markedAt ?? now, now, markedAt ? 1 : 0)
    .run();
}

export async function deleteItem(id: string) {
  const item = await env.DB.prepare("SELECT cover_key FROM items WHERE id = ?")
    .bind(id)
    .first<{ cover_key: string | null }>();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM marks WHERE item_id = ?").bind(id),
    env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id),
  ]);
  if (item?.cover_key) await env.COVERS.delete(item.cover_key);
}
