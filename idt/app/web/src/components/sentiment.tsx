import { CircleCheck, Minus, Split, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import type { SentimentIndex, SentimentLabel, ShiftSentiment } from "../idt.ts";

// Diverging: red (negative) <-> gray <-> green (positive). Validated on the panel surface; every
// segment also carries a count and label, so meaning never rides on color alone.
const COLOR = { negative: "#e66767", neutral: "#383835", positive: "#008300" } as const;

export function SentimentChip({ label }: { label: SentimentLabel | null | undefined }) {
  if (!label) return null;
  const Icon = label === "positive" ? TrendingUp : label === "negative" ? TrendingDown : Minus;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-edge px-1.5 py-0.5 text-[11px] text-muted">
      <Icon aria-hidden className="size-3" style={{ color: label === "positive" ? COLOR.positive : label === "negative" ? COLOR.negative : undefined }} />
      {label}
    </span>
  );
}

export function leanText(idx: SentimentIndex): string {
  if (idx.score === null) return "no scored posts";
  const lean = Math.abs(idx.score) < 0.2 ? "split" : idx.score > 0 ? "lean positive" : "lean negative";
  return `${idx.scored} posts ${lean} (${idx.score > 0 ? "+" : ""}${idx.score.toFixed(2)})`;
}

export function SentimentBar({ idx, compact = false }: { idx: SentimentIndex; compact?: boolean }) {
  const neutral = idx.neutral + idx.mixed;
  const total = idx.negative + neutral + idx.positive;
  if (!total) return <span className="text-xs text-faint">No posts inside the window were scored.</span>;
  const parts = [
    { key: "negative", n: idx.negative, color: COLOR.negative, label: "negative" },
    { key: "neutral", n: neutral, color: COLOR.neutral, label: "neutral or mixed" },
    { key: "positive", n: idx.positive, color: COLOR.positive, label: "positive" },
  ].filter((p) => p.n > 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="img"
        aria-label={`${idx.negative} negative, ${neutral} neutral or mixed, ${idx.positive} positive`}
        className={`flex w-full gap-0.5 overflow-hidden rounded ${compact ? "h-2" : "h-3"}`}
      >
        {parts.map((p) => (
          <div key={p.key} title={`${p.n} ${p.label}`} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            {p.n} {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const ALIGN_ICON = { aligned: CircleCheck, divergent: TriangleAlert, split: Split, market_flat: Minus, insufficient: Minus } as const;

export function AlignmentNote({ s }: { s: ShiftSentiment }) {
  const Icon = ALIGN_ICON[s.alignment.state];
  return (
    <span className={`flex items-start gap-2 text-[13px] ${s.alignment.state === "divergent" ? "text-amber" : "text-text"}`}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      {s.alignment.text}
    </span>
  );
}

export function CrowdVsMarket({ s, title = "Crowd vs market" }: { s: ShiftSentiment; title?: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs tracking-[0.12em] text-muted uppercase">{title}</span>
      <SentimentBar idx={s.overall} />
      <AlignmentNote s={s} />
      <span className="text-[11px] text-faint">
        Open search: {leanText(s.open)} · Curated: {leanText(s.curated)}. {s.source}. Descriptive only, not a trade signal.
      </span>
    </div>
  );
}
