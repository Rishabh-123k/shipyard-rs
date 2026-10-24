import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { compactPrice, pct, price, type Bucket, type CurvePoint } from "../idt.ts";

const INK = { grid: "#2a2240", axis: "#7d739b", text: "#a99fc7", strong: "#f4f0ff", surface: "#171226" };

export interface CurveSeries {
  venue: string;
  label: string;
  color: string;
  points: CurvePoint[];
}

export interface BucketSeries {
  venue: string;
  label: string;
  color: string;
  buckets: Bucket[];
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(8)));
  return out;
}

const scale = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

/** Fitted survival at x by linear interpolation; null outside the strike grid (no extrapolation). */
export function survivalAt(points: CurvePoint[], x: number): number | null {
  if (!points.length || x < points[0]!.strike || x > points[points.length - 1]!.strike) return null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (x >= a.strike && x <= b.strike) {
      return b.strike === a.strike ? a.fitted : a.fitted + ((x - a.strike) / (b.strike - a.strike)) * (b.fitted - a.fitted);
    }
  }
  return null;
}

/** Strike range where any venue's curve is still moving (0.5%–99.5%), padded by one grid step. */
export function focusDomain(series: CurveSeries[]): [number, number] {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return [0, 1];
  const live = all.filter((p) => p.fitted < 0.995 && p.fitted > 0.005);
  const pts = live.length >= 2 ? live : all;
  const ks = pts.map((p) => p.strike);
  const lo = Math.min(...ks);
  const hi = Math.max(...ks);
  const pad = (hi - lo) * 0.08 || lo * 0.02;
  return [lo - pad, hi + pad];
}

function spreadLabels(items: { y: number; key: string }[], gap: number, top: number, bottom: number) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.y - sorted[i - 1]!.y < gap) sorted[i]!.y = sorted[i - 1]!.y + gap;
  }
  const overflow = sorted.length ? sorted[sorted.length - 1]!.y - bottom : 0;
  if (overflow > 0) sorted.forEach((s) => (s.y = Math.max(top, s.y - overflow)));
  return Object.fromEntries(sorted.map((s) => [s.key, s.y]));
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const flip = x > width - 240;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 flex min-w-[200px] flex-col gap-1.5 rounded-xl border border-edge bg-night/95 px-3.5 py-3 text-[13px] shadow-xl"
      style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined, top: Math.max(0, y - 20) }}
    >
      {children}
    </div>
  );
}

function SwatchRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-muted">
        <span className="size-2.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; detail?: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-2">
          <span className="h-0.5 w-4 rounded-full" style={{ background: it.color }} />
          <span className="text-text">{it.label}</span>
          {it.detail && <span className="text-faint">{it.detail}</span>}
        </span>
      ))}
    </div>
  );
}

const M = { top: 18, right: 104, bottom: 36, left: 52 };

export function SurvivalChart({
  series,
  domain,
  spot,
  asset,
  height = 340,
}: {
  series: CurveSeries[];
  domain: [number, number];
  spot: number | null;
  asset: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const x = scale(domain[0], domain[1], M.left, M.left + plotW);
  const y = scale(0, 1, M.top + plotH, M.top);
  const xTicks = niceTicks(domain[0], domain[1], Math.max(3, Math.floor(plotW / 110)));
  const invX = (px: number) => domain[0] + ((px - M.left) / plotW) * (domain[1] - domain[0]);

  const visible = (pts: CurvePoint[]) => {
    const i0 = Math.max(0, pts.findIndex((p) => p.strike >= domain[0]) - 1);
    let i1 = pts.length - 1;
    while (i1 > 0 && pts[i1 - 1]!.strike > domain[1]) i1--;
    return pts.slice(i0, i1 + 1);
  };

  const ends = spreadLabels(
    series.map((s) => {
      const v = survivalAt(s.points, Math.min(domain[1], s.points[s.points.length - 1]?.strike ?? domain[1]));
      return { key: s.venue, y: y(v ?? 0) };
    }),
    16,
    M.top,
    M.top + plotH,
  );

  function onMove(e: MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverX(invX(e.clientX - rect.left + M.left));
  }

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Probability the price finishes above each level, by venue">
          <defs>
            <clipPath id="plot-clip">
              <rect x={M.left} y={M.top - 4} width={plotW} height={plotH + 8} />
            </clipPath>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth={1} opacity={t === 0 ? 1 : 0.6} />
              <text x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.axis}>
                {t * 100}%
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={M.top + plotH + 22} textAnchor="middle" fontSize={11} fill={INK.axis}>
              {compactPrice(t)}
            </text>
          ))}

          {spot !== null && spot >= domain[0] && spot <= domain[1] && (
            <g>
              <line x1={x(spot)} x2={x(spot)} y1={M.top} y2={M.top + plotH} stroke={INK.text} strokeWidth={1} />
              <text x={x(spot) + 6} y={M.top + 10} fontSize={11} fill={INK.strong}>
                Spot {price(spot, asset)}
              </text>
            </g>
          )}

          <g clipPath="url(#plot-clip)">
            {series.map((s) => {
              const pts = visible(s.points);
              const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.strike).toFixed(1)},${y(p.fitted).toFixed(1)}`).join("");
              return <path key={s.venue} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />;
            })}
            {series.map((s) =>
              visible(s.points).map((p) => (
                <circle
                  key={`${s.venue}-${p.strike}`}
                  cx={x(p.strike)}
                  cy={y(p.raw)}
                  r={4}
                  fill={s.color}
                  stroke={INK.surface}
                  strokeWidth={2}
                  opacity={p.raw === p.fitted ? 0.55 : 1}
                />
              )),
            )}
          </g>

          {series.map((s) => (
            <text key={s.venue} x={M.left + plotW + 10} y={ends[s.venue]} dy="0.32em" fontSize={12} fill={INK.strong}>
              {s.label}
            </text>
          ))}

          {hoverX !== null && (
            <g pointerEvents="none">
              <line x1={x(hoverX)} x2={x(hoverX)} y1={M.top} y2={M.top + plotH} stroke={INK.strong} strokeWidth={1} opacity={0.4} />
              {series.map((s) => {
                const v = survivalAt(s.points, hoverX);
                return v === null ? null : (
                  <circle key={s.venue} cx={x(hoverX)} cy={y(v)} r={5} fill={s.color} stroke={INK.surface} strokeWidth={2} />
                );
              })}
            </g>
          )}
          <rect
            x={M.left}
            y={M.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHoverX(null)}
          />
        </svg>
      )}
      {hoverX !== null && (
        <Tooltip x={x(hoverX)} y={M.top} width={width}>
          <span className="text-text">
            P(price &gt; <span className="font-mono">{price(hoverX, asset)}</span>)
          </span>
          {series.map((s) => {
            const v = survivalAt(s.points, hoverX);
            return <SwatchRow key={s.venue} color={s.color} label={s.label} value={v === null ? "outside grid" : pct(v)} />;
          })}
        </Tooltip>
      )}
    </div>
  );
}

export function BucketPanels({
  series,
  domain,
  asset,
  unit,
}: {
  series: BucketSeries[];
  domain: [number, number];
  asset: string;
  unit: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ venue: string; i: number; px: number; py: number } | null>(null);
  const height = 150;
  const m = { top: 10, right: 16, bottom: 28, left: 52 };
  const plotW = Math.max(0, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const x = scale(domain[0], domain[1], m.left, m.left + plotW);
  const density = (b: Bucket) => (b.lo !== null && b.hi !== null && b.hi > b.lo ? (b.mass / (b.hi - b.lo)) * unit : 0);
  const inside = (b: Bucket) => b.lo !== null && b.hi !== null && b.hi > domain[0] && b.lo < domain[1];
  const yMax = Math.max(1e-9, ...series.flatMap((s) => s.buckets.filter(inside).map(density)));
  const yTicks = niceTicks(0, yMax, 2);
  const yTop = yTicks[yTicks.length - 1]! >= yMax ? yTicks[yTicks.length - 1]! : yMax;
  const y = scale(0, yTop, m.top + plotH, m.top);
  const xTicks = niceTicks(domain[0], domain[1], Math.max(3, Math.floor(plotW / 110)));
  const unitLabel = unit >= 1000 ? `$${unit / 1000}k` : `$${unit}`;

  return (
    <div ref={ref} className="flex w-full flex-col gap-5">
      {width > 0 &&
        series.map((s) => {
          const lower = s.buckets[0];
          const upper = s.buckets[s.buckets.length - 1];
          const hovered = hover?.venue === s.venue ? s.buckets[hover.i] : undefined;
          return (
            <div key={s.venue} className="relative flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-4 text-[13px]">
                <span className="flex items-center gap-2 text-text">
                  <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="text-faint">
                  Below {compactPrice(lower?.hi ?? 0)}: <span className="font-mono text-muted">{pct(lower?.mass)}</span> · Above{" "}
                  {compactPrice(upper?.lo ?? 0)}: <span className="font-mono text-muted">{pct(upper?.mass)}</span>
                </span>
              </div>
              <svg width={width} height={height} role="img" aria-label={`${s.label} probability per ${unitLabel} price bucket`}>
                <clipPath id={`clip-${s.venue}`}>
                  <rect x={m.left} y={0} width={plotW} height={height} />
                </clipPath>
                {yTicks.map((t) => (
                  <g key={t}>
                    <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} stroke={INK.grid} opacity={t === 0 ? 1 : 0.6} />
                    <text x={m.left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.axis}>
                      {t === 0 ? "0%" : pct(t, t < 0.1 ? 1 : 0)}
                    </text>
                  </g>
                ))}
                {xTicks.map((t) => (
                  <text key={t} x={x(t)} y={height - 8} textAnchor="middle" fontSize={11} fill={INK.axis}>
                    {compactPrice(t)}
                  </text>
                ))}
                <g clipPath={`url(#clip-${s.venue})`}>
                  {s.buckets.map((b, i) => {
                    if (!inside(b)) return null;
                    const x0 = x(b.lo!) + 1;
                    const x1 = x(b.hi!) - 1;
                    const w = Math.max(1, x1 - x0);
                    const top = y(density(b));
                    const base = y(0);
                    const r = Math.min(4, w / 2, base - top);
                    const d = `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${base}Z`;
                    return (
                      <g key={i}>
                        <path d={d} fill={s.color} opacity={hovered && hovered !== b ? 0.45 : 1} />
                        <rect
                          x={x0 - 1}
                          y={m.top}
                          width={w + 2}
                          height={plotH}
                          fill="transparent"
                          onMouseEnter={() => setHover({ venue: s.venue, i, px: x0 + w / 2, py: top })}
                          onMouseLeave={() => setHover(null)}
                        />
                      </g>
                    );
                  })}
                </g>
              </svg>
              {hovered && hover && (
                <Tooltip x={hover.px} y={hover.py} width={width}>
                  <span className="font-mono text-text">
                    {price(hovered.lo, asset)} – {price(hovered.hi, asset)}
                  </span>
                  <SwatchRow color={s.color} label="Probability" value={pct(hovered.mass)} />
                  <SwatchRow color={s.color} label={`Per ${unitLabel}`} value={pct(density(hovered))} />
                </Tooltip>
              )}
            </div>
          );
        })}
    </div>
  );
}

export interface TimelinePoint {
  id: string;
  t: number;
  value: number | null;
  color: string;
  label: string;
  detail: string;
}

export function ShiftTimeline({
  points,
  domain,
  selected,
  onSelect,
}: {
  points: TimelinePoint[];
  domain: [number, number];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<TimelinePoint | null>(null);
  const height = 180;
  const m = { top: 14, right: 16, bottom: 28, left: 52 };
  const plotW = Math.max(0, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const vmax = Math.max(0.05, ...points.map((p) => Math.abs(p.value ?? 0))) * 1.15;
  const x = scale(domain[0], domain[1], m.left, m.left + plotW);
  const y = scale(-vmax, vmax, m.top + plotH, m.top);
  const yTicks = niceTicks(-vmax, vmax, 4);
  const hours = (domain[1] - domain[0]) / 3_600_000;
  const stepH = hours <= 30 ? 6 : hours <= 80 ? 12 : 24;
  const xTicks: number[] = [];
  const first = Math.ceil(domain[0] / (stepH * 3_600_000)) * stepH * 3_600_000;
  for (let t = first; t <= domain[1]; t += stepH * 3_600_000) xTicks.push(t);
  const fmt = (t: number) =>
    new Date(t).toLocaleString("en-US", { hour: "numeric", ...(stepH >= 12 ? { month: "short", day: "numeric" } : {}), timeZone: "America/New_York" });

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Shift events over time; height is the change in probability of finishing above spot">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} stroke={INK.grid} opacity={t === 0 ? 1 : 0.5} />
              <text x={m.left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.axis}>
                {t === 0 ? "0" : `${t > 0 ? "+" : "−"}${Math.abs(t * 100).toFixed(0)}pp`}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={height - 8} textAnchor="middle" fontSize={11} fill={INK.axis}>
              {fmt(t)}
            </text>
          ))}
          {points.map((p) => {
            const cx = x(p.t);
            const cy = y(p.value ?? 0);
            const isSel = p.id === selected;
            return (
              <g key={p.id} className="cursor-pointer" onClick={() => onSelect(p.id)} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
                <line x1={cx} x2={cx} y1={y(0)} y2={cy} stroke={p.color} strokeWidth={1} opacity={0.5} />
                <circle cx={cx} cy={cy} r={isSel ? 6 : 4.5} fill={p.value === null ? INK.surface : p.color} stroke={isSel ? INK.strong : INK.surface} strokeWidth={2} />
                {p.value === null && <circle cx={cx} cy={cy} r={3} fill="none" stroke={p.color} strokeWidth={1.5} />}
                <circle cx={cx} cy={cy} r={10} fill="transparent" />
              </g>
            );
          })}
        </svg>
      )}
      {hover && (
        <Tooltip x={x(hover.t)} y={y(hover.value ?? 0)} width={width}>
          <span className="text-text">{hover.label}</span>
          <span className="text-muted">{hover.detail}</span>
        </Tooltip>
      )}
    </div>
  );
}
