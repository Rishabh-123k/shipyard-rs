import { useMemo, useState } from "react";
import { BucketPanels, focusDomain, Legend, SurvivalChart, type CurveSeries } from "../components/charts.tsx";
import { Page } from "../components/AppShell.tsx";
import { Segmented } from "../components/controls.tsx";
import { Banner, Card, Label, Spinner } from "../components/ui.tsx";
import {
  etDate,
  etDateLabel,
  etTime,
  pct,
  price,
  useDistributions,
  useLadders,
  venueMeta,
  type DistributionView,
  type IdtAsset,
  type LadderEntry,
} from "../idt.ts";

const ASSETS: IdtAsset[] = ["BTC", "ETH"];
const BUCKET_UNIT: Record<IdtAsset, number> = { BTC: 1000, ETH: 25 };

/** One ladder per venue per ET day: the latest close that day (Kalshi also lists intraday hourly ladders). */
function byDay(entries: LadderEntry[]): Map<string, LadderEntry[]> {
  const days = new Map<string, Map<string, LadderEntry>>();
  for (const e of entries) {
    const key = etDate(e.resolution_at);
    const venues = days.get(key) ?? new Map();
    const prev = venues.get(e.venue);
    if (!prev || e.resolution_at > prev.resolution_at) venues.set(e.venue, e);
    days.set(key, venues);
  }
  return new Map(
    [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, [...v.values()].sort((a, b) => a.venue.localeCompare(b.venue)).reverse()]),
  );
}

function violations(d: DistributionView): number {
  return d.points.reduce((n, p, i) => (i && p.raw > d.points[i - 1]!.raw ? n + 1 : n), 0);
}

function HeadlineTile({ d, dayLabel }: { d: DistributionView; dayLabel: string }) {
  const v = venueMeta(d.venue);
  const p = d.p_above_spot;
  return (
    <Card className="flex flex-1 flex-col gap-3 p-5">
      <span className="flex items-center gap-2 text-[13px] text-muted">
        <span className="size-2.5 rounded-full" style={{ background: v.color }} />
        {v.label} · resolves {etTime(d.resolution_at)} ET
      </span>
      <span className="text-[44px] leading-none font-bold">{p ? pct(p.prob) : "—"}</span>
      <span className="text-sm text-muted">
        chance {d.asset} finishes above today's spot{p ? ` (${price(p.level, d.asset)})` : ""} on {dayLabel}
      </span>
      {p?.clamped && <span className="text-xs text-amber">Spot sits outside the strike grid: {p.clamped}.</span>}
    </Card>
  );
}

function SpotTile({ d }: { d: DistributionView }) {
  const s = d.spot;
  return (
    <Card className="flex w-[280px] shrink-0 flex-col gap-3 p-5">
      <Label>Spot · True Markets</Label>
      <span className="text-[32px] leading-none font-bold">{s ? price(s.mid, d.asset) : "unavailable"}</span>
      {s && (
        <span className="flex flex-col gap-0.5 font-mono text-xs text-muted">
          <span>
            bid {price(s.bid, d.asset)} · ask {price(s.ask, d.asset)}
          </span>
          <span>{s.spread_bps.toFixed(0)} bps between $10 buy and sell quotes</span>
        </span>
      )}
    </Card>
  );
}

function CoherenceNote({ dists }: { dists: DistributionView[] }) {
  const rows = dists.map((d) => ({ d, n: violations(d) }));
  const any = rows.some((r) => r.n > 0);
  return (
    <Card className="flex flex-col gap-2 p-5 text-sm">
      <Label>Coherence correction</Label>
      {!any && <span className="text-muted">Raw mid quotes were already a valid (non-increasing) curve. No correction needed.</span>}
      {rows.map(({ d, n }) => (
        <span key={d.venue} className="text-muted">
          <span className="text-text">{venueMeta(d.venue).label}:</span>{" "}
          {n > 0
            ? `raw quotes went up with the strike ${n} time${n > 1 ? "s" : ""}, which is impossible for a real distribution. The weighted isotonic fit moved them by ${(d.coherence_score * 100).toFixed(2)} percentage points in total.`
            : "monotone as quoted."}
        </span>
      ))}
    </Card>
  );
}

function q(d: DistributionView, level: number): string {
  const x = d.quantiles.find((v) => Math.abs(v.q - level) < 1e-9);
  if (!x) return "—";
  return x.value !== null ? price(x.value, d.asset) : x.bound!.replace(/[\d,]+/, (n) => price(Number(n.replace(/,/g, "")), d.asset));
}

function StatsTable({ dists }: { dists: DistributionView[] }) {
  const rows: [string, (d: DistributionView) => string][] = [
    ["10th percentile", (d) => q(d, 0.1)],
    ["25th percentile", (d) => q(d, 0.25)],
    ["Median", (d) => q(d, 0.5)],
    ["75th percentile", (d) => q(d, 0.75)],
    ["90th percentile", (d) => q(d, 0.9)],
    ["Implied mean*", (d) => price(d.mean, d.asset)],
    ["Interquartile range", (d) => price(d.iqr, d.asset)],
    ["IQR / median", (d) => pct(d.iqr_over_median, 2)],
    ["Strikes used / dropped", (d) => `${d.points.length} / ${d.dropped.length}`],
  ];
  return (
    <Card className="overflow-hidden">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="px-5 py-3 font-normal text-muted">Implied distribution</th>
            {dists.map((d) => (
              <th key={d.venue} className="px-5 py-3 text-right font-bold">
                <span className="inline-flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: venueMeta(d.venue).color }} />
                  {venueMeta(d.venue).label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn]) => (
            <tr key={label} className="border-b border-line last:border-0">
              <td className="px-5 py-2.5 text-muted">{label}</td>
              {dists.map((d) => (
                <td key={d.venue} className="px-5 py-2.5 text-right font-mono">
                  {fn(d)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col gap-1 border-t border-line px-5 py-3 text-xs text-faint">
        {dists.map((d) => (
          <span key={d.venue}>
            *{venueMeta(d.venue).label}: {d.mean_assumption}
          </span>
        ))}
      </div>
    </Card>
  );
}

function DataTables({ dists }: { dists: DistributionView[] }) {
  return (
    <details className="rounded-[18px] border border-edge bg-panel">
      <summary className="cursor-pointer px-5 py-3.5 text-sm font-bold">Data table: every strike, raw quote and fitted value</summary>
      <div className="flex flex-col gap-6 px-5 pb-5">
        {dists.map((d) => (
          <div key={d.venue} className="flex flex-col gap-2">
            <span className="text-sm text-text">{venueMeta(d.venue).label}</span>
            <div className="max-h-[320px] overflow-y-auto rounded-xl border border-line">
              <table className="w-full border-collapse font-mono text-xs">
                <thead className="sticky top-0 bg-panel">
                  <tr className="text-right text-muted">
                    {["Strike", "Bid", "Ask", "Raw (mid)", "Fitted", "Adjusted", "Volume"].map((h) => (
                      <th key={h} className="px-3 py-2 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.points.map((p) => (
                    <tr key={p.strike} className="border-t border-line text-right">
                      <td className="px-3 py-1.5">{price(p.strike, d.asset)}</td>
                      <td className="px-3 py-1.5">{pct(p.bid)}</td>
                      <td className="px-3 py-1.5">{pct(p.ask)}</td>
                      <td className="px-3 py-1.5">{pct(p.raw, 2)}</td>
                      <td className="px-3 py-1.5">{pct(p.fitted, 2)}</td>
                      <td className={`px-3 py-1.5 ${p.raw !== p.fitted ? "text-amber" : "text-faint"}`}>
                        {p.raw !== p.fitted ? `${((p.fitted - p.raw) * 100).toFixed(2)} pp` : "—"}
                      </td>
                      <td className="px-3 py-1.5">{Math.round(p.volume).toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.dropped.length > 0 && (
              <span className="text-xs text-faint">
                Dropped: {d.dropped.map((x) => `${x.market_id} (${x.reason})`).join("; ")}
              </span>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function Rules({ dists }: { dists: DistributionView[] }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {dists.map((d) => (
        <details key={d.venue} className="rounded-[18px] border border-edge bg-panel">
          <summary className="cursor-pointer px-5 py-3.5 text-sm">
            <span className="font-bold">{venueMeta(d.venue).label} resolution rules</span>{" "}
            <span className="text-faint">{venueMeta(d.venue).when}</span>
          </summary>
          <p className="m-0 px-5 pb-5 text-[13px] leading-relaxed whitespace-pre-line text-muted">{d.rules || "No rules text returned."}</p>
        </details>
      ))}
    </div>
  );
}

export function Markets() {
  const [asset, setAsset] = useState<IdtAsset>("BTC");
  const [day, setDay] = useState<string | null>(null);
  const ladders = useLadders(asset);
  const days = useMemo(() => byDay(ladders.data ?? []), [ladders.data]);
  const fallback = [...days.entries()].find(([, v]) => v.length > 1)?.[0] ?? [...days.keys()][0] ?? null;
  const selected = day && days.has(day) ? day : fallback;
  const entries = selected ? (days.get(selected) ?? []) : [];
  const results = useDistributions(asset, entries);
  const dists = results.map((r) => r.data).filter((d): d is DistributionView => d !== undefined && d.asset === asset);
  const failed = results.find((r) => r.error)?.error;

  const series: CurveSeries[] = dists.map((d) => ({ venue: d.venue, ...venueMeta(d.venue), points: d.points }));
  const domain = focusDomain(series);
  const spot = dists.find((d) => d.spot)?.spot ?? null;
  const dayLabel = selected ? etDateLabel(selected) : "";

  return (
    <Page title="Markets" subtitle="What prediction markets imply about where the price lands, checked against live True Markets spot.">
      <div className="flex flex-wrap items-center gap-4">
        <Segmented label="Asset" value={asset} onChange={(a) => { setAsset(a); setDay(null); }} options={ASSETS.map((a) => ({ value: a, label: a }))} />
        <span className="h-6 w-px bg-edge" />
        {days.size > 0 && (
          <Segmented
            label="Resolution date"
            value={selected ?? ""}
            onChange={setDay}
            options={[...days.entries()].map(([k, v]) => ({
              value: k,
              label: etDateLabel(k),
              detail: v.map((e) => venueMeta(e.venue).label[0]).join("+"),
            }))}
          />
        )}
      </div>

      {ladders.error && (
        <Banner tone="error" title="Couldn't load market ladders">
          {ladders.error.message}
        </Banner>
      )}
      {failed && !ladders.error && (
        <Banner tone="error" title="Couldn't load a distribution">
          {failed.message}
        </Banner>
      )}
      {(ladders.isPending || (entries.length > 0 && dists.length === 0 && !failed)) && <Spinner label="Fetching ladders from Polymarket and Kalshi" />}
      {ladders.data && days.size === 0 && <Banner title="No liquid ladders">No venue lists a usable {asset} price ladder right now.</Banner>}

      {dists.length > 0 && (
        <>
          <div className="flex gap-4">
            {dists.map((d) => (
              <HeadlineTile key={d.venue} d={d} dayLabel={dayLabel} />
            ))}
            <SpotTile d={dists[0]!} />
          </div>

          <Card className="flex flex-col gap-4 p-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold">Chance {asset} finishes above each price on {dayLabel}</h2>
                <span className="text-[13px] text-muted">Lines are the coherent fit. Dots are raw mid quotes; brighter dots were adjusted by the fit.</span>
              </div>
              <Legend items={series.map((s) => ({ label: s.label, color: s.color, detail: venueMeta(s.venue).when }))} />
            </div>
            <SurvivalChart series={series} domain={domain} spot={spot?.mid ?? null} asset={asset} />
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1">
              <h2 className="m-0 text-lg font-bold">Where the probability sits</h2>
              <span className="text-[13px] text-muted">
                Probability per {asset === "BTC" ? "$1,000" : "$25"} of price, so venues with different strike spacing compare fairly. Hover a bar for the bucket's total.
              </span>
            </div>
            <BucketPanels
              series={dists.map((d) => ({ venue: d.venue, ...venueMeta(d.venue), buckets: d.buckets }))}
              domain={domain}
              asset={asset}
              unit={BUCKET_UNIT[asset]}
            />
          </Card>

          <div className="grid grid-cols-[3fr_2fr] gap-4">
            <StatsTable dists={dists} />
            <div className="flex flex-col gap-4">
              <CoherenceNote dists={dists} />
              <Card className="flex flex-col gap-2 p-5 text-[13px] text-muted">
                <Label>Read with care</Label>
                {dists[0]!.caveats.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </Card>
            </div>
          </div>

          <Rules dists={dists} />
          <DataTables dists={dists} />
        </>
      )}
    </Page>
  );
}
