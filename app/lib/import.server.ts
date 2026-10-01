import { storeCover } from "./covers.server";
import { findBySource, insertItem, saveMark, setCoverKey, type Mark, type NewItem } from "./db.server";
import { isKind, isStatus } from "./kinds";

/** One record in an import file: an item plus your mark on it. */
export type ImportRow = NewItem & Mark;

export type ImportResult = { added: number; updated: number; errors: string[] };

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseRow(raw: unknown): ImportRow | string {
  if (!raw || typeof raw !== "object") return "不是对象";
  const r = raw as Record<string, unknown>;
  const title = str(r.title);
  if (!title) return "缺少 title";
  if (!isKind(r.kind)) return `${title}：kind 无效`;
  if (!isStatus(r.status)) return `${title}：status 无效`;
  const markedOn = str(r.marked_on);
  if (!markedOn || !/^\d{4}-\d{2}-\d{2}$/.test(markedOn)) return `${title}：marked_on 需要是 YYYY-MM-DD`;
  const rating = Number(r.rating);
  const coverUrl = str(r.cover_url);
  return {
    kind: r.kind,
    title,
    original_title: str(r.original_title),
    year: Number.isInteger(Number(r.year)) && Number(r.year) > 0 ? Number(r.year) : null,
    creators: str(r.creators),
    summary: str(r.summary),
    cover_url: coverUrl && /^https?:\/\//.test(coverUrl) ? coverUrl : null,
    source: str(r.source) ?? "manual",
    source_id: str(r.source_id),
    source_url: str(r.source_url),
    status: r.status,
    rating: r.status !== "wish" && rating >= 1 && rating <= 5 ? Math.round(rating) : null,
    comment: str(r.comment),
    marked_on: markedOn,
  };
}

/**
 * Imports a batch of marks. Items already imported from the same source are
 * matched by source id, so re-running an import updates marks instead of
 * duplicating items.
 */
export async function importRows(rows: unknown[]): Promise<ImportResult> {
  const result: ImportResult = { added: 0, updated: 0, errors: [] };
  await Promise.all(
    rows.map(async (raw) => {
      const row = parseRow(raw);
      if (typeof row === "string") {
        result.errors.push(row);
        return;
      }
      const { status, rating, comment, marked_on, ...item } = row;
      try {
        const existing = item.source_id ? await findBySource(item.source, item.source_id) : null;
        let id = existing?.id;
        if (!id) id = await insertItem(item, await storeCover(item.cover_url));
        else if (!existing?.cover_key && item.cover_url) {
          // A cover that failed to copy last time gets another try on re-import.
          const coverKey = await storeCover(item.cover_url);
          if (coverKey) await setCoverKey(id, coverKey);
        }
        await saveMark(id, { status, rating, comment, marked_on });
        existing ? result.updated++ : result.added++;
      } catch (error) {
        result.errors.push(`${item.title}：${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  return result;
}
