import { POSITIVE_DECIMAL } from "../../shared/validation.ts";
import type { AssetRow, BalanceItem, Portfolio, PortfolioBalance, TransactionDetail } from "./types.ts";

export function isPositiveDecimal(value: string): boolean {
  return POSITIVE_DECIMAL.test(value);
}

export function sanitizeDecimal(input: string): string {
  return input.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

export function usd(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs !== 0 && abs < 1 ? Math.min(8, Math.max(3, 2 - Math.floor(Math.log10(abs)) + 1)) : 2;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.min(digits, 2),
    maximumFractionDigits: digits,
  });
}

export function signedUsd(value: number | string): string {
  const n = Number(value);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${usd(Math.abs(n))}`;
}

export function tokenAmount(qty: string | number, symbol?: string): string {
  const n = Number(qty);
  const text = Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 6 : 4 }) : String(qty);
  return symbol ? `${text} ${symbol}` : text;
}

export function percent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  const sign = ratio > 0 ? "+" : ratio < 0 ? "−" : "";
  return `${sign}${Math.abs(ratio * 100).toFixed(1)}%`;
}

export function toRatio(value: string | null | undefined, scale = 1): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value) / scale;
  return Number.isFinite(n) ? n : null;
}

const CHAIN_NAMES: Record<string, string> = { solana: "Solana", base: "Base", ethereum: "Ethereum" };

export function chainName(chain: string | null): string {
  return chain ? (CHAIN_NAMES[chain] ?? chain) : "";
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (seconds < 86_400 && new Date(now).getDate() === date.getDate()) return `Today, ${time}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + `, ${time}`;
}

// Exact decimal math on strings so a "75%" chip never asks to sell more than the balance holds.
export function fractionOf(amount: string, percentage: number, decimals: number): string {
  const [whole = "0", frac = ""] = amount.split(".");
  const scaled = BigInt(whole + frac.padEnd(decimals, "0").slice(0, decimals));
  const part = (scaled * BigInt(percentage)) / 100n;
  const digits = part.toString().padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

export interface Holding {
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number;
  total: string;
  available: string;
  chain: string | null;
  cash: boolean;
  price: number | null;
  value: number | null;
  change: number | null;
}

export function holdings(portfolio: Portfolio | undefined, assets: AssetRow[] | undefined): Holding[] {
  if (!portfolio) return [];
  const polled = new Map((assets ?? []).map((a) => [`${a.symbol}:${a.chain}`, a]));

  const rows = portfolio.balances as (BalanceItem & Partial<PortfolioBalance>)[];
  return rows.map((row) => {
    const asset = polled.get(`${row.symbol}:${row.chain}`);
    const price = toRatio(row.price) ?? (row.stable ? 1 : toRatio(asset?.price));
    return {
      symbol: row.symbol,
      name: row.name,
      icon: row.icon ?? asset?.icon ?? null,
      decimals: row.decimals,
      total: row.total,
      available: row.available,
      chain: row.chain,
      cash: asset?.cash ?? false,
      price,
      value: toRatio(row.value) ?? (price === null ? null : Number(row.total) * price),
      change: row.stable ? null : (toRatio(row.change_24h_pct, 100) ?? toRatio(asset?.change_24h)),
    };
  });
}

export interface TransactionView {
  glyph: string;
  glyphColor: string;
  title: string;
  detail: string;
  amount: string;
  // USD at the time of the transaction; null when no historical price exists.
  value: string | null;
}

// Conductor's failure_reason is the wrapped internal error chain; its last segment is the part a customer can act on.
export function failureMessage(reason: string | null): string {
  if (!reason) return "";
  const last = reason.split(": ").at(-1) ?? reason;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export function describeTransaction(tx: TransactionDetail, assets: AssetRow[] = []): TransactionView {
  const symbol = tx.asset_symbol ?? tx.order?.asset_symbol ?? tx.order?.base_asset ?? tx.transfer?.asset_symbol ?? "";
  const sign = tx.asset_flow === "in" ? "+" : "−";
  const amount = tx.qty ? `${sign}${tokenAmount(tx.qty, symbol)}` : "—";
  const detail = failureMessage(tx.failure_reason);
  const moved = tx.status !== "failed" && tx.status !== "canceled";

  if (tx.type === "order" && tx.order) {
    const buy = tx.order.side === "buy";
    const executed = Number(tx.order.executed_qty) * Number(tx.order.executed_vwap);
    return {
      glyph: buy ? "↗" : "↘",
      glyphColor: buy ? "text-up" : "text-accent",
      title: `${buy ? "Bought" : "Sold"} ${symbol}`,
      detail: detail || "Market order",
      amount,
      value: moved && executed > 0 ? usd(executed) : null,
    };
  }
  if (tx.type === "transfer") {
    const transfer = tx.transfer;
    const inQuote = transfer?.qty_unit === "quote";
    const tokens = inQuote ? transfer?.sent : tx.qty;
    const cash = assets.some((a) => a.cash && a.symbol === symbol && a.chain === transfer?.chain);
    return {
      glyph: "↑",
      glyphColor: "text-cyan",
      title: `Sent ${symbol}`,
      detail: detail || (transfer ? `To ${shortAddress(transfer.to)}` : ""),
      amount: tokens && Number(tokens) > 0 ? `−${tokenAmount(tokens, symbol)}` : amount,
      value: moved && tx.qty && (inQuote || cash) ? usd(tx.qty) : null,
    };
  }
  return { glyph: "+", glyphColor: "text-cyan", title: `Ramp ${symbol}`.trim(), detail, amount, value: null };
}
