import { useState } from "react";

/** Shows freshly made recovery codes once, with copy and download. */
export function RecoveryCodes({ codes, handle, onDone }: { codes: string[]; handle: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `后记 @${handle} 的恢复码（每个只能用一次）\n\n${codes.join("\n")}\n`;

  return (
    <section className="rounded-lg border border-line bg-card p-5 sm:p-6">
      <h2 className="text-xl font-semibold">保存恢复码</h2>
      <p className="mt-2 text-sm text-muted">
        通行密钥所在的设备都丢了时，用其中一个恢复码加用户名登录。每个只能用一次，这里只显示这一次。
      </p>
      <ul className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-base tracking-wider">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}
          className="rounded-full border border-line px-4 py-1.5 transition hover:border-muted"
        >
          {copied ? "已复制" : "复制"}
        </button>
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download={`afterword-${handle}-recovery-codes.txt`}
          className="rounded-full border border-line px-4 py-1.5 transition hover:border-muted"
        >
          下载
        </a>
        <button
          type="button"
          onClick={onDone}
          className="rounded-full bg-ink px-5 py-1.5 text-paper transition hover:opacity-85"
        >
          我已经保存好了
        </button>
      </div>
    </section>
  );
}
