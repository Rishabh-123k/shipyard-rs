import { useQuery } from "@tanstack/react-query";
import type { AssetRow, Page, Portfolio, Profile, TransactionDetail } from "./types.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface Envelope {
  code?: string;
  message?: string;
}

export async function api<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const envelope = (data ?? {}) as Envelope;
    throw new ApiError(res.status, envelope.message ?? `request failed with status ${res.status}`, envelope.code);
  }
  return data as T;
}

// Conductor and Tensho both mark a quote that can no longer be signed with code quote_stale.
export function isPriceMoved(err: unknown): boolean {
  return err instanceof ApiError && err.code === "quote_stale";
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Profile>("/api/me") });
}

// Wallet-scoped reads answer 409 until the gateway user is seated, so they wait for it.
function useWalletReady(): boolean {
  return useMe().data?.ready ?? false;
}

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: () => api<Portfolio>("/api/portfolio"),
    refetchInterval: 15_000,
    enabled: useWalletReady(),
  });
}

export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: () => api<AssetRow[]>("/api/assets"),
    refetchInterval: 15_000,
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: ["transactions"],
    queryFn: () => api<Page<TransactionDetail>>("/api/transactions"),
    refetchInterval: 15_000,
    enabled: useWalletReady(),
  });
}
