import { CrowdVsMarket, SentimentBar, SentimentChip } from "../components/sentiment.tsx";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { focusDomain, Legend, ShiftTimeline, SurvivalChart, type CurveSeries } from "../components/charts.tsx";
import { Page } from "../components/AppShell.tsx";
import { Segmented } from "../components/controls.tsx";
import { Banner, Card, Label, Spinner } from "../components/ui.tsx";
import { etDateLabel, etDate, etStamp, pct, price, useShift, useShifts, venueMeta, type IdtAsset, type ShiftDetail, type ShiftRow, type XPostView } from "../idt.ts";

const WINDOWS = [
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
];
const BEFORE = "#7d739b";

const STATUS: Record<string, string> = {
  done: "posts retrieved",
  running: "searching X…",
  queued: "queued for X search",
  cooldown: "X search skipped (cooldown)",
  not_searched: "not searched",
  error: "X search failed",
};

function delta(a: number | null, b: number | null, fmt: (v: number | null) => string) {
  return `${fmt(a)} → ${fmt(b)}`;
}

function ShiftCard({ r, selected, onSelect }: { r: ShiftRow; selected: boolean; onSelect: () => void }) {
  const v = venueMeta(r.venue);
  const dp = r.p_before !== null && r.p_after !== null ? r.p_after - r.p_before : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full cursor-pointer flex-col gap-1.5 rounded-2xl border px-4 py-3 text-left ${
        selected ? "border-muted bg-line" : "border-edge bg-panel hover:border-muted"
      }`}
    >
      <span className="flex items-center justify-between gap-3 text-[13px]">
        <span className="flex items-center gap-2 text-text">
          <span className="size-2.5 rounded-full" style={{ background: v.color }} />
          {v.label} · {etDateLabel(etDate(r.resolution_at))} ladder
        </span>
        <span className="text-faint">{etStamp(r.window_end)}</span>
      </span>
      <span className="font-mono text-sm">
        P(&gt;{price(r.level, r.asset)}) {delta(r.p_before, r.p_after, (x) => pct(x))}
        {dp !== null && <span className={dp < 0 ? "text-down" : "text-up"}> ({dp > 0 ? "+" : "−"}{Math.abs(dp * 100).toFixed(1)}pp)</span>}
      </span>
      <span className="font-mono text-xs text-muted">median {delta(r.median_before, r.median_after, (x) => price(x, r.asset))}</span>
      <span className="flex flex-wrap gap-2 text-xs text-faint">
        <span>{r.n_posts ? `${r.n_posts} posts` : STATUS[r.xsearch_status] ?? r.xsearch_status}</span>
        {r.source === "backfill" && <span className="text-amber">reconstructed from price history</span>}
      </span>
      {r.sentiment.overall.scored > 0 && (
        <span className="flex flex-col gap-1">
          <SentimentBar idx={r.sentiment.overall} compact />
          {r.sentiment.alignment.state === "divergent" && <span className="text-xs text-amber">crowd and prices disagree</span>}
          {r.sentiment.alignment.state === "aligned" && <span className="text-xs text-faint">crowd and prices agree</span>}
        </span>
      )}
    </button>
  );
}

function PostCard({ p }: { p: XPostView }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="flex items-center gap-2 text-text">
          @{p.author ?? "unknown"} <SentimentChip label={p.sentiment} />
        </span>
        <span className="flex items-center gap-3 text-faint">
          <span className={p.in_window ? "text-up" : ""}>{p.in_window ? "inside window" : "outside window"}</span>
          {etStamp(p.posted_at)}
          <a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-1">
            X <ExternalLink aria-hidden className="size-3" />
          </a>
        </span>
      </div>
      {p.text ? (
        <p className="m-0 text-sm leading-relaxed text-muted">
          “{p.text}” <span className="text-xs text-faint">(as quoted by Grok)</span>
        </p>
      ) : (
        <p className="m-0 text-xs text-faint">Grok cited this post but didn't return its text. Open it on X.</p>
      )}
    </div>
  );
}

function Detail({ d }: { d: ShiftDetail }) {
  const [mode, setMode] = useState<"open" | "curated">("open");
  const v = venueMeta(d.venue);
  const series: CurveSeries[] = [
    { venue: "before", label: "Before", color: BEFORE, points: d.before.points },
    { venue: "after", label: "After", color: v.color, points: d.after.points },
  ];
  const run = d.runs.find((r) => r.query_mode === mode);
  const all = d.posts[mode] ?? [];
  const posts = all.filter((p) => p.text).sort((a, b) => Number(b.in_window) - Number(a.in_window) || a.posted_at.localeCompare(b.posted_at));
  const linkOnly = all.filter((p) => !p.text);
  const searching = ["queued", "running"].includes(d.xsearch_status);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-lg font-bold">
              {v.label} {d.asset} ladder for {etDateLabel(etDate(d.resolution_at))}
            </h2>
            <span className="text-[13px] text-muted">
              {etStamp(d.window_start)} → {etStamp(d.window_end)} · snapshots {d.before.snapshot_id.slice(0, 8)} → {d.after.snapshot_id.slice(0, 8)}
            </span>
          </div>
          <Legend
            items={[
              { label: "Before", color: BEFORE, detail: etStamp(d.before.taken_at) },
              { label: "After", color: v.color, detail: etStamp(d.after.taken_at) },
            ]}
          />
        </div>
        <SurvivalChart series={series} domain={focusDomain(series)} spot={d.level} asset={d.asset} height={300} />
        <div className="flex flex-wrap gap-2">
          {d.reasons.map((r) => (
            <span key={r} className="rounded-lg border border-edge px-2.5 py-1 font-mono text-xs text-muted">
              {r}
            </span>
          ))}
        </div>
        {d.before.source === "backfill" && (
          <span className="text-xs text-amber">
            Reconstructed from venue price history. Kalshi points use historical bid/ask; Polymarket points use last trade prices.
          </span>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="m-0 text-lg font-bold">X posts from this window</h2>
          <Segmented
            label="Search mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "open", label: "Open search", detail: String(d.posts.open?.length ?? 0) },
              { value: "curated", label: "Curated handles", detail: String(d.posts.curated?.length ?? 0) },
            ]}
          />
        </div>
        {searching && <Spinner label="Grok is searching X for this window" />}
        {d.sentiment.overall.scored > 0 && <CrowdVsMarket s={d.sentiment} />}
        {d.xsearch_status === "not_searched" && (
          <span className="text-sm text-muted">This shift wasn't among the ones searched on X (searches are capped to the largest moves).</span>
        )}
        {run && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-warn-edge bg-warn-bg px-4 py-3">
            <Label>Grok's summary · a summary, not evidence</Label>
            <p className="m-0 text-sm leading-relaxed text-warn-text">{run.grok_summary ?? "No summary returned."}</p>
            <span className="text-xs text-faint">
              {run.model} · searched {etStamp(run.search_from)} → {etStamp(run.search_to)} · {run.n_citations} citations
              {mode === "curated" && run.handles ? ` · handles: ${run.handles.join(", ")}` : ""}
              {run.error ? ` · error: ${run.error}` : ""}
            </span>
          </div>
        )}
        {all.length === 0 && !searching && <span className="text-sm text-muted">No posts stored for this mode.</span>}
        <div className="flex flex-col gap-2.5">
          {posts.map((p) => (
            <PostCard key={p.post_id} p={p} />
          ))}
        </div>
        {linkOnly.length > 0 && (
          <details className="rounded-xl border border-line">
            <summary className="cursor-pointer px-4 py-3 text-[13px] text-muted">
              {linkOnly.length} more posts Grok cited without returning their text ({linkOnly.filter((p) => p.in_window).length} inside the window)
            </summary>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 pb-3 text-xs">
              {linkOnly.map((p) => (
                <a key={p.post_id} href={p.url} target="_blank" rel="noreferrer" className={p.in_window ? "" : "text-faint"}>
                  {etStamp(p.posted_at)}
                </a>
              ))}
            </div>
          </details>
        )}
      </Card>
    </div>
  );
}

export function Shifts() {
  const [params] = useSearchParams();
  const linked = params.get("event");
  const [asset, setAsset] = useState<IdtAsset>(params.get("asset") === "ETH" ? "ETH" : "BTC");
  const [hours, setHours] = useState(linked ? "168" : "24");
  const [picked, setPicked] = useState<string | null>(linked);
  const rows = useShifts(asset, Number(hours));
  const list = rows.data ?? [];
  const selected = picked && list.some((r) => r.event_id === picked) ? picked : (list.find((r) => r.n_posts > 0) ?? list[0])?.event_id ?? null;
  const detail = useShift(selected);
  const now = Date.now();

  return (
    <Page title="Shifts" subtitle="When the implied distribution moves, Grok searches X for the posts from that window.">
      <div className="flex flex-wrap items-center gap-4">
        <Segmented label="Asset" value={asset} onChange={(a) => { setAsset(a); setPicked(null); }} options={[{ value: "BTC", label: "BTC" }, { value: "ETH", label: "ETH" }]} />
        <span className="h-6 w-px bg-edge" />
        <Segmented label="Time window" value={hours} onChange={(h) => { setHours(h); setPicked(null); }} options={WINDOWS} />
      </div>

      {rows.error && <Banner tone="error" title="Couldn't load shifts">{rows.error.message}</Banner>}
      {rows.isPending && <Spinner label="Loading shift events from Snowflake" />}
      {rows.data && list.length === 0 && (
        <Banner title="No shifts in this window">
          The snapshot job hasn't recorded a material move for {asset} in the last {WINDOWS.find((w) => w.value === hours)?.label}.
        </Banner>
      )}

      {list.length > 0 && (
        <>
          <Card className="flex flex-col gap-3 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-lg font-bold">{list.length} shift events</h2>
                <span className="text-[13px] text-muted">Height is the change in the chance of finishing above spot. Click a dot or a card.</span>
              </div>
              <Legend items={[...new Set(list.map((r) => r.venue))].map((vn) => ({ label: venueMeta(vn).label, color: venueMeta(vn).color }))} />
            </div>
            <ShiftTimeline
              points={list.map((r) => ({
                id: r.event_id,
                t: Date.parse(r.window_end),
                value: r.p_before !== null && r.p_after !== null ? r.p_after - r.p_before : null,
                color: venueMeta(r.venue).color,
                label: `${venueMeta(r.venue).label} · ${etDateLabel(etDate(r.resolution_at))} ladder`,
                detail: `${etStamp(r.window_end)} · ${r.reasons[0] ?? ""}`,
              }))}
              domain={[now - Number(hours) * 3_600_000, now]}
              selected={selected}
              onSelect={setPicked}
            />
          </Card>

          <div className="grid grid-cols-[340px_1fr] items-start gap-4">
            <div className="flex max-h-[900px] flex-col gap-2 overflow-y-auto pr-1">
              {list.map((r) => (
                <ShiftCard key={r.event_id} r={r} selected={r.event_id === selected} onSelect={() => setPicked(r.event_id)} />
              ))}
            </div>
            {detail.data ? <Detail d={detail.data} /> : detail.isPending ? <Spinner /> : detail.error ? <Banner tone="error">{detail.error.message}</Banner> : null}
          </div>
        </>
      )}
    </Page>
  );
}
