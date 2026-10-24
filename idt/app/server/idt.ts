import { env } from "./env.ts";
import { ApiError } from "./http.ts";

// Tradeable token symbol -> the asset whose implied distribution is the evidence for it.
const EVIDENCE_ASSET: Record<string, string> = { CBBTC: "BTC", BTC: "BTC", WBTC: "BTC", ETH: "ETH", WETH: "ETH" };

export interface TradeRecord {
  trade_id: string;
  customer_id: string;
  asset: string;
  side: "buy" | "sell";
  usd_amount: number;
  status: string;
  dry_run: boolean;
  order_id?: string;
  quote?: unknown;
  version: string;
  snapshot_id: string;
  event_id?: string | null;
  cited_post_ids: string[];
  rationale?: string;
}

export interface IdtClient {
  assetFor(symbol: string): string | undefined;
  evidenceVersion(asset: string): Promise<string | null>;
  recordTrade(trade: TradeRecord): Promise<void>;
  updateTrade(tradeId: string, update: { status: string; order_id?: string; error?: string }): Promise<void>;
  liveTotalUsd(): Promise<number>;
  journal(customerId: string): Promise<unknown>;
  cefiQuote(asset: string, side: "buy" | "sell", usd: number): Promise<CefiQuote>;
}

export interface CefiQuote {
  price: number;
  qty: string | null;
  notional: string | null;
  fee: string | null;
  source: string;
}

async function engine<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${env.IDT_ENGINE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: { Accept: "application/json", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch(() => {
    throw new ApiError(503, "unavailable", "the cryptoshi engine (journal and evidence) is unreachable, so nothing was traded");
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { detail?: unknown }).detail;
    const message = typeof detail === "string" ? detail : `cryptoshi engine returned ${res.status}`;
    throw new ApiError(res.status === 409 ? 409 : 503, res.status === 409 ? "failed_precondition" : "unavailable", message, {
      code: res.status === 409 ? "evidence_changed" : undefined,
    });
  }
  return (await res.json()) as T;
}

export const idt: IdtClient = {
  assetFor: (symbol) => EVIDENCE_ASSET[symbol.toUpperCase()],
  evidenceVersion: async (asset) =>
    (await engine<{ version: string | null }>(`/internal/evidence/version?asset=${encodeURIComponent(asset)}`)).version,
  recordTrade: async (trade) => {
    await engine("/internal/trades", { method: "POST", body: trade });
  },
  updateTrade: async (tradeId, update) => {
    await engine(`/internal/trades/${encodeURIComponent(tradeId)}`, { method: "PATCH", body: update });
  },
  liveTotalUsd: async () => (await engine<{ total_usd: number }>("/internal/trades/total")).total_usd,
  journal: (customerId) => engine(`/internal/journal?customer_id=${encodeURIComponent(customerId)}`),
  cefiQuote: (asset, side, usd) =>
    engine<CefiQuote>(`/internal/quote?${new URLSearchParams({ asset, side, usd: usd.toFixed(2) })}`),
};
