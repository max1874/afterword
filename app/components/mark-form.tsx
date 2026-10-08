import { useState } from "react";
import { Form, useNavigation } from "react-router";

import { StarInput } from "./stars";
import { STATUSES, statusLabel, type Kind, type Status } from "~/lib/kinds";

export function MarkForm({
  kind,
  initial,
  today,
}: {
  kind: Kind;
  initial: { status?: Status | null; rating?: number | null; comment?: string | null; marked_on?: string | null };
  today: string;
}) {
  const [status, setStatus] = useState<Status>(initial.status ?? "done");
  const [rating, setRating] = useState<number | null>(initial.rating ?? null);
  const navigation = useNavigation();
  const saving = navigation.state !== "idle" && navigation.formData?.get("intent") === "save";

  return (
    <Form method="post" className="space-y-5">
      <input type="hidden" name="intent" value="save" />
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">状态</legend>
        {STATUSES.map((s) => (
          <label
            key={s}
            className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm transition ${status === s ? "border-ink bg-ink text-paper" : "border-line text-muted hover:text-ink"}`}
          >
            <input
              type="radio"
              name="status"
              value={s}
              checked={status === s}
              onChange={() => setStatus(s)}
              className="sr-only"
            />
            {statusLabel(s, kind)}
          </label>
        ))}
      </fieldset>

      {status !== "wish" ? <StarInput value={rating} onChange={setRating} /> : null}

      <label className="block">
        <span className="mb-1.5 block text-sm text-muted">日期</span>
        <input type="date" name="marked_on" defaultValue={initial.marked_on ?? today} required />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm text-muted">短评</span>
        <textarea
          name="comment"
          rows={4}
          defaultValue={initial.comment ?? ""}
          placeholder="写点什么，或者留白。"
          className="w-full"
        />
      </label>

      <button
        disabled={saving}
        className="rounded-full bg-accent px-6 py-2 text-accent-ink transition hover:opacity-90 disabled:opacity-60"
      >
        {saving ? "保存中…" : "保存"}
      </button>
    </Form>
  );
}
