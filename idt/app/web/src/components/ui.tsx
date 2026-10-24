import { AlertTriangle, LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { percent } from "../format.ts";

type Variant = "primary" | "secondary";

const BUTTON_BASE =
  "inline-flex h-12 items-center justify-center gap-2 border px-[22px] font-mono text-[14px] font-medium no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-40";

const BUTTON_VARIANT: Record<Variant, string> = {
  primary: "border-text bg-text text-ink hover:bg-white hover:text-ink",
  secondary: "border-text bg-transparent text-text hover:bg-text hover:text-ink",
};

function buttonClass(variant: Variant = "primary", extra = ""): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className = "", ...props }: LinkProps & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function TextButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="cursor-pointer border-none bg-transparent p-0 font-bold text-cyan underline">
      {children}
    </button>
  );
}

export function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between py-3 text-sm ${last ? "" : "border-b border-line"}`}>
      <span className="text-muted">{label}</span>
      <Mono>{value}</Mono>
    </div>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-[18px] border border-edge bg-panel ${className}`}>{children}</section>;
}

export function Mono({ className = "", children }: { className?: string; children: ReactNode }) {
  return <span className={`font-mono tabular-nums ${className}`}>{children}</span>;
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">{children}</span>;
}

export function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Mono className="text-[26px]">{value}</Mono>
      {detail && <Mono className="text-sm text-muted">{detail}</Mono>}
    </div>
  );
}

export function Banner({
  tone = "warning",
  title,
  children,
}: {
  tone?: "warning" | "error";
  title?: string;
  children: ReactNode;
}) {
  const palette =
    tone === "warning"
      ? "border-warn-edge bg-warn-bg text-warn-text"
      : "border-down/40 bg-down/10 text-text";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-3.5 rounded-2xl border px-5 py-4 ${palette}`}>
      <AlertTriangle aria-hidden className={`mt-0.5 size-5 shrink-0 ${tone === "warning" ? "text-amber" : "text-down"}`} />
      <div className="flex flex-col gap-1 text-sm leading-relaxed">
        {title && <span className={`text-[15px] font-bold ${tone === "warning" ? "text-warn-title" : ""}`}>{title}</span>}
        <span>{children}</span>
      </div>
    </div>
  );
}

const TILE_COLORS: Record<string, string> = { USDC: "bg-cyan", SOL: "bg-violet", PENGU: "bg-amber", ETH: "bg-cyan" };
const TILE_FALLBACK = ["bg-accent", "bg-cyan", "bg-violet", "bg-amber", "bg-up"];
const TILE_LABELS: Record<string, string> = { USDC: "USD", PENGU: "PG" };

function tileColor(symbol: string): string {
  const known = TILE_COLORS[symbol];
  if (known) return known;
  const hash = [...symbol].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return TILE_FALLBACK[hash % TILE_FALLBACK.length]!;
}

export function AssetTile({ symbol, icon, size = 40 }: { symbol: string; icon?: string | null; size?: number }) {
  const style = { width: size, height: size, borderRadius: size * 0.28 };
  if (icon) return <img src={icon} alt="" style={style} className="shrink-0 bg-line object-cover" />;
  return (
    <div
      aria-hidden
      style={style}
      className={`flex shrink-0 items-center justify-center text-xs font-bold text-ink ${tileColor(symbol)}`}
    >
      {TILE_LABELS[symbol] ?? symbol.slice(0, 3)}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      {label}
    </span>
  );
}

export function PriceChange({ ratio, className = "" }: { ratio: number | null; className?: string }) {
  const color = ratio === null || ratio === 0 ? "text-muted" : ratio > 0 ? "text-up" : "text-down";
  return <Mono className={`${color} ${className}`}>{percent(ratio)}</Mono>;
}

export type SettlementState = "signing" | "pending" | "succeeded" | "failed" | "timed_out" | "dry_run";

export function SettlementNotice({
  state,
  success,
  failure,
  explorerUrl,
  onDone,
}: {
  state: SettlementState;
  success: string;
  failure?: string;
  explorerUrl?: string | null;
  onDone: () => void;
}) {
  if (state === "signing") return <Spinner label="Signing and submitting…" />;
  if (state === "pending") return <Spinner label="Submitted. Waiting for the network…" />;

  const outcome = {
    succeeded: { tone: "border-up/40 bg-up/10", message: success },
    failed: { tone: "border-down/40 bg-down/10", message: failure || "It didn't go through. Nothing moved." },
    timed_out: { tone: "border-warn-edge bg-warn-bg", message: "Still pending after a minute. Check Activity for the final status." },
    dry_run: { tone: "border-warn-edge bg-warn-bg", message: "Dry run: nothing was signed or sent. The trade and its evidence are in your journal." },
  }[state];
  const { tone, message } = outcome;
  return (
    <div role="status" className={`flex flex-col gap-3 rounded-2xl border px-4 py-3.5 text-sm ${tone}`}>
      <span>{message}</span>
      <div className="flex items-center justify-between">
        {explorerUrl ? (
          <a href={explorerUrl} target="_blank" rel="noreferrer">
            View on explorer
          </a>
        ) : (
          <span />
        )}
        <Button variant="secondary" className="h-9 px-4 text-sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function TxAmount({ amount, value, className = "" }: { amount: string; value: string | null; className?: string }) {
  return (
    <span className={`flex flex-col items-end gap-0.5 ${className}`}>
      <Mono className="text-sm">{amount}</Mono>
      {value && <Mono className="text-xs text-muted">{value}</Mono>}
    </span>
  );
}

export function TxGlyph({ glyph, color }: { glyph: string; color: string }) {
  return (
    <div className={`flex size-9 shrink-0 items-center justify-center rounded-full border border-edge font-mono ${color}`}>
      {glyph}
    </div>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-[34px] items-center justify-center border border-text font-mono text-sm font-medium">
        ID
      </div>
      <span className="flex flex-col leading-tight">
        <span className="font-display text-[20px] font-bold tracking-tight">idt</span>
        <span className="font-mono text-[9px] whitespace-nowrap text-faint">implied distribution terminal</span>
      </span>
    </div>
  );
}

export function GridHorizon({ className = "" }: { className?: string }) {
  const rays = [-152, 114, 380, 646, 912];
  return (
    <svg viewBox="0 0 760 190" preserveAspectRatio="xMidYMax slice" aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}>
      {[
        [105, 0.4],
        [129, 0.3],
        [160, 0.2],
      ].map(([y, opacity]) => (
        <line key={y} x1="0" y1={y} x2="760" y2={y} stroke="#f5f5f5" strokeWidth="1" opacity={opacity} />
      ))}
      {rays.map((x) => (
        <line key={x} x1="380" y1="105" x2={x} y2="190" stroke="#f5f5f5" strokeWidth="1" opacity="0.2" />
      ))}
    </svg>
  );
}
