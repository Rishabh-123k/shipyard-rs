export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; detail?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex h-9 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm ${
            o.value === value ? "border-muted bg-line font-bold text-text" : "border-edge bg-transparent text-muted hover:text-text"
          }`}
        >
          {o.label}
          {o.detail && <span className="text-xs font-normal text-faint">{o.detail}</span>}
        </button>
      ))}
    </div>
  );
}
