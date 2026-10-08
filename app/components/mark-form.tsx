import { useState } from "react";
import { Form, useNavigation } from "react-router";

import { StarInput } from "./stars";
import { STATUSES, statusLabel, type Kind, type Status } from "~/lib/kinds";

export function MarkForm({
  kind,
  initial,
  today,
  ratings = true,
}: {
  kind: Kind;
  initial: { status?: Status | null; rating?: number | null; comment?: string | null; marked_on?: string | null };
  today: string;
  /** Off when the person turned ratings off; the saved rating then rides along unchanged. */
  ratings?: boolean;
}) {
  const [status, setStatus] = useState<Status>(initial.status ?? "done");
  const [rating, setRating] = useState<number | null>(initial.rating ?? null);
  const navigation = useNavigation();
  const saving = navigation.state !== "idle" && navigation.formData?.get("intent") === "save";

  return (
    <Form method="post" className="space-y-5">
      <input type="hidden" name="intent" value="save" />
      <fieldset className="flex w-full max-w-sm rounded-[10px] bg-line/50 p-[3px] text-sm font-medium">
        <legend className="sr-only">状态</legend>
        {STATUSES.map((s) => (
          <label
            key={s}
            className={`flex-1 cursor-pointer rounded-[8px] py-1.5 text-center transition ${status === s ? "bg-paper shadow-[0_1px_3px_rgba(0,0,0,0.12)] dark:bg-line" : "text-muted hover:text-ink"}`}
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

      {!ratings ? (
        <input type="hidden" name="rating" value={initial.rating ?? ""} />
      ) : status !== "wish" ? (
        <StarInput value={rating} onChange={setRating} />
      ) : null}

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
        className="rounded-full bg-ink px-6 py-2 font-semibold text-paper transition hover:opacity-90 disabled:opacity-60"
      >
        {saving ? "保存中…" : "保存"}
      </button>
    </Form>
  );
}
