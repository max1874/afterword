export function Stars({ rating, className = "" }: { rating: number | null; className?: string }) {
  if (!rating) return null;
  return (
    <span className={`tracking-[0.1em] text-seal ${className}`} aria-label={`${rating} 星`}>
      {"★".repeat(rating)}
      <span className="text-line">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

/** Radio-based star picker; clicking the current rating again clears it. */
export function StarInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-2xl" role="radiogroup" aria-label="评分">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} 星`}
          onClick={() => onChange(value === n ? null : n)}
          className={`leading-none transition ${value && n <= value ? "text-seal" : "text-line hover:text-muted"}`}
        >
          ★
        </button>
      ))}
      <input type="hidden" name="rating" value={value ?? ""} />
    </div>
  );
}
