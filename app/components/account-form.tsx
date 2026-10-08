import { useState } from "react";

import { RecoveryCodes } from "./recovery-codes";
import { passkeyMessage, registerPasskey } from "~/lib/passkey";

/**
 * Handle and name, then a new passkey; shared by the owner's first setup and
 * invited sign-ups. Shows the recovery codes before going to the new page.
 */
export function AccountForm({
  kind,
  initial,
  extra,
  submitLabel,
}: {
  kind: "setup" | "join";
  initial?: { handle: string; name: string };
  extra?: Record<string, string>;
  submitLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ codes: string[]; next: string; handle: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries([...form].map(([k, v]) => [k, String(v)]));
    setBusy(true);
    setError(null);
    try {
      const result = await registerPasskey(kind, { ...fields, ...extra });
      setDone({ codes: result.codes ?? [], next: result.next ?? "/", handle: fields.handle.replace(/^@/, "").toLowerCase() });
    } catch (e) {
      setError(passkeyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <RecoveryCodes codes={done.codes} handle={done.handle} onDone={() => window.location.replace(done.next)} />;
  }

  return (
    // method="post": a submit before hydration must not put the password in the URL.
    <form method="post" onSubmit={submit} className="space-y-4">
      {kind === "setup" ? (
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">部署时设置的 OWNER_PASSWORD</span>
          <input name="password" type="password" autoComplete="off" required className="w-full" />
        </label>
      ) : null}
      <label className="block">
        <span className="mb-1.5 block text-sm text-muted">用户名，用在主页地址 /@用户名</span>
        <input
          name="handle"
          defaultValue={initial?.handle}
          autoComplete="username"
          pattern="@?[a-zA-Z0-9_]{2,20}"
          required
          className="w-full"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm text-muted">名字，显示在主页上</span>
        <input name="name" defaultValue={initial?.name} maxLength={40} required className="w-full" />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button
        disabled={busy}
        className="w-full rounded-md bg-accent py-2 text-accent-ink transition hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "等待通行密钥…" : submitLabel}
      </button>
      <p className="text-xs text-muted">会用这台设备的 Touch ID、Face ID 或手机创建通行密钥，不需要密码。</p>
    </form>
  );
}
