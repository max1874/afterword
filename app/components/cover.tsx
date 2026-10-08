import { useState } from "react";

/** Book-cover-shaped image; shows the title on a plain card when there is no image. */
export function Cover({
  src,
  title,
  className = "",
}: {
  src: string | null;
  title: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`relative aspect-[2/3] overflow-hidden rounded-[7px] bg-card shadow-[0_4px_14px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.08)] ${className}`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="grid size-full place-items-center p-3 text-center text-sm text-muted">
          {title}
        </div>
      )}
    </div>
  );
}
