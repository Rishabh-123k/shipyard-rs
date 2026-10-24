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
