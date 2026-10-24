import { errorMessage } from "./tm/errors.ts";
import { priceHistory } from "./tm/gateway.ts";

export interface PriceQuote {
  price: string | null;
  change_24h: string | null;
  as_of: string | null;
}

export interface PriceBook {
  get(symbol: string): PriceQuote;
}

const EMPTY: PriceQuote = { price: null, change_24h: null, as_of: null };

const quotes = new Map<string, PriceQuote>();
const failing = new Set<string>();
let timer: ReturnType<typeof setInterval> | undefined;

function relativeChange(first: string, last: string): string | null {
  const from = Number(first);
  if (!Number.isFinite(from) || from === 0) return null;
  return ((Number(last) - from) / from).toFixed(4);
}

async function refresh(symbol: string, fetchHistory: typeof priceHistory): Promise<void> {
  const key = symbol.toUpperCase();
  try {
    const { points } = await fetchHistory(symbol);
    const first = points[0];
    const last = points.at(-1);
    if (!first || !last) throw new Error("no price points");
    quotes.set(key, { price: last.price, change_24h: relativeChange(first.price, last.price), as_of: last.t });
    failing.delete(key);
  } catch (err) {
    if (failing.has(key)) return;
    failing.add(key);
    console.warn(`price poll for ${symbol} failed: ${errorMessage(err)}`);
  }
}

export function startPricePoller(symbols: string[], intervalMs = 15_000, fetchHistory = priceHistory): void {
  const poll = () => Promise.allSettled(symbols.map((s) => refresh(s, fetchHistory)));
  void poll();
  timer = setInterval(poll, intervalMs);
}

export function stopPricePoller(): void {
  clearInterval(timer);
  timer = undefined;
  quotes.clear();
  failing.clear();
}

export const prices: PriceBook = {
  get(symbol) {
    return quotes.get(symbol.toUpperCase()) ?? EMPTY;
  },
};
