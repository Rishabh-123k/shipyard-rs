import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

export type IdtAsset = "BTC" | "ETH";

export interface LadderEntry {
  venue: string;
  resolution_at: string;
  n_points: number;
  n_dropped: number;
}

export interface CurvePoint {
  strike: number;
  raw: number;
  fitted: number;
  bid: number | null;
  ask: number | null;
  volume: number;
  market_ids: string[];
  from_last: boolean;
}

export interface Bucket {
  lo: number | null;
  hi: number | null;
  mass: number;
}

export interface QuantileValue {
  q: number;
  value: number | null;
  bound: string | null;
}

export interface Spot {
  asset: string;
  mid: number;
  bid: number;
  ask: number;
  spread_bps: number;
  taken_at: string;
  source: string;
}

export interface DistributionView {
  asset: IdtAsset;
  venue: string;
  resolution_at: string;
  rules: string;
  overround: number | null;
  points: CurvePoint[];
  dropped: { market_id: string; reason: string }[];
  coherence_score: number;
  buckets: Bucket[];
  quantiles: QuantileValue[];
  mean: number;
  mean_assumption: string;
  iqr: number | null;
  iqr_over_median: number | null;
  p_above_spot: { level: number; prob: number; clamped: string | null } | null;
  caveats: string[];
  spot: Spot | null;
}

export const VENUES: Record<string, { label: string; color: string; when: string }> = {
  polymarket: { label: "Polymarket", color: "#3987e5", when: "noon ET · Binance BTC/USDT 1m close" },
  kalshi: { label: "Kalshi", color: "#d95926", when: "5pm ET · CF Benchmarks 60s average" },
};

export function venueMeta(venue: string) {
  return VENUES[venue] ?? { label: venue, color: "#a99fc7", when: "" };
}

export function etDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function etDateLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function etTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

export function useLadders(asset: IdtAsset) {
  return useQuery({
    queryKey: ["idt", "ladders", asset],
    queryFn: () => api<LadderEntry[]>(`/api/idt/ladders?asset=${asset}`),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useDistributions(asset: IdtAsset, entries: LadderEntry[]) {
  return useQueries({
    queries: entries.map((e) => ({
      queryKey: ["idt", "distribution", asset, e.venue, e.resolution_at],
      queryFn: () =>
        api<DistributionView>(
          `/api/idt/distribution?${new URLSearchParams({ asset, venue: e.venue, resolution_at: e.resolution_at })}`,
        ),
      refetchInterval: 30_000,
      placeholderData: keepPreviousData,
    })),
  });
}

export function pct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function price(v: number | null | undefined, asset: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: asset === "ETH" ? 2 : 0 });
}

export function compactPrice(v: number): string {
  return v >= 10_000 ? `$${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export interface ShiftRow {
  sentiment: ShiftSentiment;

  event_id: string;
  asset: IdtAsset;
  venue: string;
  resolution_at: string;
  window_start: string;
  window_end: string;
  level: number;
  d_median: number | null;
  d_p_above_spot: number | null;
  wasserstein: number | null;
  reasons: string[];
  xsearch_status: string;
  source: string;
  n_posts: number;
  median_before: number | null;
  median_after: number | null;
  p_before: number | null;
  p_after: number | null;
}

export interface StoredSnapshot {
  snapshot_id: string;
  venue: string;
  resolution_at: string;
  taken_at: string;
  source: string;
  points: CurvePoint[];
  quantiles: QuantileValue[];
}

export interface XPostView {
  sentiment: SentimentLabel | null;

  post_id: string;
  url: string;
  author: string | null;
  posted_at: string;
  text: string | null;
  text_source: string;
  in_window: boolean;
}

export interface XRun {
  run_id: string;
  query_mode: string;
  model: string;
  grok_summary: string | null;
  search_from: string;
  search_to: string;
  handles: string[] | null;
  error: string | null;
  n_citations: number;
}

export interface ShiftDetail {
  sentiment: ShiftSentiment;

  event_id: string;
  asset: IdtAsset;
  venue: string;
  resolution_at: string;
  window_start: string;
  window_end: string;
  level: number;
  reasons: string[];
  xsearch_status: string;
  before: StoredSnapshot;
  after: StoredSnapshot;
  posts: Record<string, XPostView[]>;
  runs: XRun[];
}

export interface AskEvent {
  ref: string;
  event_id: string;
  asset: string;
  venue: string;
  resolution_at: string;
  window_start: string;
  window_end: string;
  prev_snapshot_id: string;
  snapshot_id: string;
  source: string;
  level: number;
  median_before: number | null;
  median_after: number | null;
  p_before: number | null;
  p_after: number | null;
}

export interface AskState {
  ref: string;
  snapshot_id: string;
  asset: string;
  venue: string;
  resolution_at: string;
  taken_at: string;
  quantiles: QuantileValue[];
  p_above_spot: { level: number; prob: number } | null;
}

export interface AskPost {
  sentiment?: SentimentLabel | null;

  ref: string;
  post_id: string;
  url: string;
  author: string | null;
  posted_at: string;
  text: string | null;
  in_window: boolean;
  modes: string[];
  sim: number;
}

export interface AskResponse {
  question: string;
  refused: boolean;
  answer: string;
  model?: string;
  window: { start: string; end: string; label: string };
  numbers: AskEvent[];
  state: AskState[];
  posts: AskPost[];
  cited?: string[];
  warnings: string[];
  caveats: string[];
}

export function useShifts(asset: IdtAsset, hours: number) {
  return useQuery({
    queryKey: ["idt", "shifts", asset, hours],
    queryFn: () => api<ShiftRow[]>(`/api/idt/shifts?asset=${asset}&hours=${hours}`),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useShift(eventId: string | null) {
  return useQuery({
    queryKey: ["idt", "shift", eventId],
    queryFn: () => api<ShiftDetail>(`/api/idt/shifts/${encodeURIComponent(eventId!)}`),
    enabled: eventId !== null,
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.xsearch_status) ? 10_000 : false),
  });
}

export function etStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
}

export const EVIDENCE_ASSET: Record<string, IdtAsset> = { CBBTC: "BTC", BTC: "BTC", WBTC: "BTC", ETH: "ETH", WETH: "ETH" };

export interface EvidenceLadder {
  snapshot_id: string;
  venue: string;
  resolution_at: string;
  taken_at: string;
  p_above_spot: { level: number; prob: number; clamped: string | null } | null;
  median: number | null;
  coherence_score: number;
}

export interface EvidencePost {
  sentiment: SentimentLabel | null;

  post_id: string;
  url: string;
  author: string | null;
  posted_at: string;
  text: string;
  in_window: boolean;
}

export interface EvidenceEvent {
  sentiment: ShiftSentiment;

  event_id: string;
  venue: string;
  resolution_at: string;
  window_start: string;
  window_end: string;
  level: number;
  reasons: string[];
  source: string;
  p_before: number | null;
  p_after: number | null;
  posts: EvidencePost[];
}

export interface Evidence {
  asset: IdtAsset;
  version: string | null;
  taken_at: string | null;
  age_seconds: number | null;
  fresh_for_seconds: number;
  refreshing: boolean;
  ladders: EvidenceLadder[];
  event: EvidenceEvent | null;
}

export function useEvidence(asset: IdtAsset | undefined) {
  return useQuery({
    queryKey: ["idt", "evidence", asset],
    queryFn: () => api<Evidence>(`/api/idt/evidence?asset=${asset}`),
    enabled: asset !== undefined,
    refetchInterval: (q) => (q.state.data?.refreshing || !q.state.data?.version ? 4_000 : 15_000),
    placeholderData: keepPreviousData,
  });
}

export interface TradeGuardInfo {
  dry_run: boolean;
  max_order_usd: number;
  max_total_usd: number;
}

export function useTradeGuard() {
  return useQuery({ queryKey: ["trade-guard"], queryFn: () => api<TradeGuardInfo>("/api/trade-guard"), staleTime: Infinity });
}

export interface JournalEntry {
  trade_id: string;
  created_at: string;
  asset: IdtAsset;
  side: "buy" | "sell";
  usd_amount: number;
  quote: { base_asset?: string; qty_out?: string } | null;
  order_id: string | null;
  status: string;
  dry_run: boolean;
  rationale: string | null;
  error: string | null;
  snapshot_id: string;
  venue: string;
  resolution_at: string;
  snapshot_taken_at: string;
  event_id: string | null;
  cited_post_ids: string[];
  evidence: { version: string; ladders: EvidenceLadder[]; event: EvidenceEvent | null } | null;
  thesis: {
    level: number | null;
    p_at_trade: number | null;
    p_latest: number | null;
    latest_snapshot_id: string | null;
    latest_taken_at: string | null;
    resolved: boolean;
  };
}

export function useJournal() {
  return useQuery({ queryKey: ["journal"], queryFn: () => api<JournalEntry[]>("/api/journal"), refetchInterval: 30_000 });
}

export type SentimentLabel = "positive" | "negative" | "neutral" | "mixed";

export interface SentimentIndex {
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
  posts: number;
  scored: number;
  score: number | null;
}

export interface ShiftSentiment {
  overall: SentimentIndex;
  open: SentimentIndex;
  curated: SentimentIndex;
  alignment: { state: "aligned" | "divergent" | "split" | "market_flat" | "insufficient"; text: string };
  source: string;
}
