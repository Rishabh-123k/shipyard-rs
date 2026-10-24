import { AlignmentNote } from "../components/sentiment.tsx";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { Page } from "../components/AppShell.tsx";
import { Banner, ButtonLink, Card, Label, Spinner } from "../components/ui.tsx";
import { usd } from "../format.ts";
import { etDate, etDateLabel, etStamp, pct, price, useJournal, venueMeta, type JournalEntry } from "../idt.ts";

const STATUS_TONE: Record<string, string> = {
  complete: "text-up border-up/40",
  dry_run: "text-amber border-warn-edge",
  failed: "text-down border-down/40",
  rejected: "text-down border-down/40",
  canceled: "text-muted border-edge",
};

function Thesis({ t, asset, side }: { t: JournalEntry["thesis"]; asset: string; side: "buy" | "sell" }) {
  if (t.level === null || t.p_at_trade === null) return <span className="text-sm text-muted">No P(above spot) recorded for this ladder.</span>;
  const delta = t.p_latest !== null ? t.p_latest - t.p_at_trade : null;
  // A buy is a bet the price finishes higher; a sell is the opposite.
  const toward = delta === null || delta === 0 ? null : (delta > 0) === (side === "buy");
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-sm">
        P({asset} &gt; {price(t.level, asset)}): {pct(t.p_at_trade)} at trade
        {t.p_latest !== null && (
          <>
            {" "}→ {pct(t.p_latest)} now{" "}
            <span className={toward === null ? "text-muted" : toward ? "text-up" : "text-down"}>
              ({delta! > 0 ? "+" : "−"}
              {Math.abs(delta! * 100).toFixed(1)}pp)
            </span>
          </>
        )}
      </span>
      <span className="text-xs text-faint">
        {t.p_latest === null
          ? "No later snapshot of this ladder yet."
          : `${toward ? "Moved toward" : toward === false ? "Moved against" : "Unchanged for"} your ${side} · latest snapshot ${etStamp(t.latest_taken_at!)}`}
        {t.resolved && " · this ladder has resolved"}
      </span>
    </div>
  );
}

function Entry({ e }: { e: JournalEntry }) {
  const v = venueMeta(e.venue);
  const posts = e.evidence?.event?.posts.filter((p) => e.cited_post_ids.includes(p.post_id)) ?? [];
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-bold capitalize">
            {e.side} {usd(e.usd_amount)} of {e.asset}
          </span>
          <span className="text-xs text-faint">
            {etStamp(e.created_at)} · trade <span className="font-mono">{e.trade_id.slice(0, 8)}</span>
            {e.order_id && (
              <>
                {" "}
                · order <span className="font-mono">{e.order_id.slice(0, 8)}</span>
              </>
            )}
          </span>
        </div>
        <span className={`rounded-lg border px-2.5 py-1 text-xs ${STATUS_TONE[e.status] ?? "border-edge text-muted"}`}>
          {e.status === "dry_run" ? "dry run" : e.status}
        </span>
      </div>

      {e.rationale && <p className="m-0 rounded-xl border border-line px-3.5 py-2.5 text-sm text-text">“{e.rationale}”</p>}
      {e.error && <span className="text-xs text-down">{e.error}</span>}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label>Thesis ladder</Label>
          <span className="flex items-center gap-2 text-sm">
            <span className="size-2.5 rounded-full" style={{ background: v.color }} />
            {v.label} · {etDateLabel(etDate(e.resolution_at))}
          </span>
          <span className="text-xs text-faint">
            snapshot <span className="font-mono">{e.snapshot_id.slice(0, 8)}</span> · {etStamp(e.snapshot_taken_at)}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <Label>How the thesis aged</Label>
          <Thesis t={e.thesis} asset={e.asset} side={e.side} />
        </div>
      </div>

      {e.evidence?.event && (
        <div className="flex flex-col gap-2">
          <Label>
            Shift on record ·{" "}
            <Link to={`/shifts?event=${encodeURIComponent(e.evidence.event.event_id)}&asset=${e.asset}`} className="normal-case tracking-normal">
              open in Shifts
            </Link>
          </Label>
          <span className="text-[13px] text-muted">
            {venueMeta(e.evidence.event.venue).label} · {etStamp(e.evidence.event.window_start)} → {etStamp(e.evidence.event.window_end)} ·{" "}
            {e.evidence.event.reasons[0]}
          </span>
          {e.evidence.event.sentiment && e.evidence.event.sentiment.overall.scored > 0 && <AlignmentNote s={e.evidence.event.sentiment} />}
        </div>
      )}

      {posts.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Posts you cited</Label>
          {posts.map((p) => (
            <div key={p.post_id} className="flex flex-col gap-1 rounded-xl border border-line px-3.5 py-2.5 text-[13px]">
              <span className="flex items-center gap-2 text-text">
                @{p.author ?? "unknown"} <span className="text-xs text-faint">{etStamp(p.posted_at)}</span>
                <a href={p.url} target="_blank" rel="noreferrer" className="flex items-center text-xs">
                  X <ExternalLink aria-hidden className="ml-0.5 size-3" />
                </a>
              </span>
              <span className="line-clamp-2 text-muted">“{p.text}”</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function Journal() {
  const journal = useJournal();
  return (
    <Page title="Journal" subtitle="Every trade with the snapshot, shift and posts behind it, and how that view has held up since.">
      {journal.error && <Banner tone="error" title="Couldn't load the journal">{journal.error.message}</Banner>}
      {journal.isPending && <Spinner label="Loading trades from Snowflake" />}
      {journal.data && journal.data.length === 0 && (
        <Card className="flex flex-col items-start gap-3 p-6">
          <span className="text-muted">No trades yet. Trades placed from the Trade page land here with their evidence.</span>
          <ButtonLink to="/trade" variant="secondary">
            Go to Trade
          </ButtonLink>
        </Card>
      )}
      <div className="grid grid-cols-2 items-start gap-4">
        {journal.data?.map((e) => (
          <Entry key={e.trade_id} e={e} />
        ))}
      </div>
    </Page>
  );
}
