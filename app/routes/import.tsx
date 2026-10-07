import { useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/import";
import { isKind, isStatus, KINDS, kindLabel, statusLabel } from "~/lib/kinds";
import { requireViewer } from "~/lib/session.server";

const BATCH_SIZE = 20;

export function meta() {
  return [{ title: "导入 · 后记" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireViewer(request);
  return { handle: viewer.handle };
}

type Progress = { done: number; added: number; updated: number; errors: string[] };

export default function Import() {
  const [rows, setRows] = useState<unknown[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);

  async function readFile(file: File | undefined) {
    setRows(null);
    setProgress(null);
    setFileError(null);
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error("文件内容需要是一个数组");
      setRows(data);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  }

  async function run() {
    if (!rows) return;
    setRunning(true);
    const state: Progress = { done: 0, added: 0, updated: 0, errors: [] };
    setProgress({ ...state });
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch),
        });
        const result = await res.json<{ added?: number; updated?: number; errors?: string[]; error?: string }>();
        if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
        state.added += result.added ?? 0;
        state.updated += result.updated ?? 0;
        state.errors.push(...(result.errors ?? []));
      } catch (error) {
        state.errors.push(`第 ${i + 1}–${i + batch.length} 条：${error instanceof Error ? error.message : String(error)}`);
      }
      state.done = Math.min(i + BATCH_SIZE, rows.length);
      setProgress({ ...state, errors: [...state.errors] });
    }
    setRunning(false);
  }

  const summary = rows ? summarize(rows) : [];

  return (
    <>
      <h1 className="mb-3 text-3xl font-semibold">导入</h1>
      <p className="mb-8 max-w-2xl text-sm text-muted">
        选择一个 JSON 文件，内容是标记的数组，每条包含 <code>kind</code>、<code>status</code>、<code>title</code>、
        <code>marked_on</code>，以及可选的 <code>original_title</code>、<code>year</code>、<code>creators</code>、
        <code>cover_url</code>、<code>rating</code>、<code>comment</code>、<code>source</code>、<code>source_id</code>、
        <code>source_url</code>。同一来源的条目按 <code>source_id</code> 匹配，重复导入只会更新标记。
      </p>

      <input
        type="file"
        accept="application/json,.json"
        disabled={running}
        onChange={(event) => readFile(event.target.files?.[0])}
        className="w-full max-w-md"
      />
      {fileError ? <p className="mt-3 text-sm text-seal">无法读取：{fileError}</p> : null}

      {rows ? (
        <section className="mt-8 rounded-lg border border-line bg-card p-5 sm:p-6">
          <h2 className="text-xl font-semibold">共 {rows.length} 条</h2>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            {summary.map(({ kind, counts }) => (
              <li key={kind}>
                {kindLabel(kind)}：{counts.map(([status, n]) => `${statusLabel(status, kind)} ${n}`).join(" · ")}
              </li>
            ))}
          </ul>
          <button
            onClick={run}
            disabled={running || (progress?.done ?? 0) === rows.length}
            className="mt-5 rounded-full bg-seal px-6 py-2 text-seal-ink transition hover:opacity-90 disabled:opacity-60"
          >
            {running ? "导入中…" : progress ? "已导入" : "开始导入"}
          </button>
        </section>
      ) : null}

      {progress && rows ? (
        <section className="mt-6 text-sm">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-seal transition-all" style={{ width: `${(progress.done / rows.length) * 100}%` }} />
          </div>
          <p className="mt-3">
            {progress.done} / {rows.length} · 新增 {progress.added} · 更新 {progress.updated}
            {progress.errors.length ? ` · 失败 ${progress.errors.length}` : ""}
          </p>
          {progress.errors.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-seal">
              {progress.errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          ) : null}
          {!running && progress.done === rows.length ? (
            <Link to="/" className="mt-4 inline-block text-seal underline underline-offset-4">
              去首页看看
            </Link>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function summarize(rows: unknown[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    if (isKind(r?.kind) && isStatus(r?.status)) counts.set(`${r.kind}:${r.status}`, (counts.get(`${r.kind}:${r.status}`) ?? 0) + 1);
  }
  return KINDS.map((kind) => ({
    kind,
    counts: (["done", "doing", "wish"] as const)
      .map((status) => [status, counts.get(`${kind}:${status}`) ?? 0] as const)
      .filter(([, n]) => n > 0),
  })).filter((k) => k.counts.length > 0);
}
