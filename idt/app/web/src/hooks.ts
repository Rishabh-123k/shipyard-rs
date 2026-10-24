import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import type { SettlementState } from "./components/ui.tsx";

const QUOTE_REFRESH_MS = 10_000;
const SETTLE_POLL_MS = 2_000;
const SETTLE_TIMEOUT_MS = 60_000;

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// Polling pauses in a hidden tab, so a returning viewer gets a fresh quote before they can confirm a stale one.
function useLiveQuote<T>(path: string, body: Record<string, string>, enabled: boolean, refresh: boolean) {
  return useQuery({
    queryKey: ["quote", path, body],
    queryFn: () => api<T>(path, { method: "POST", body }),
    enabled,
    refetchInterval: refresh ? QUOTE_REFRESH_MS : false,
    refetchOnWindowFocus: "always",
    retry: false,
    gcTime: 0,
  });
}

export function settlementState(input: {
  signing: boolean;
  startedAt: number | null;
  status: string | undefined;
  terminal: readonly string[];
  success: string;
  now: number;
}): SettlementState | null {
  const { signing, startedAt, status, terminal, success, now } = input;
  if (signing) return "signing";
  if (startedAt === null) return null;
  if (status !== undefined && terminal.includes(status)) return status === success ? "succeeded" : "failed";
  return now - startedAt > SETTLE_TIMEOUT_MS ? "timed_out" : "pending";
}

function useSettlement<T extends { status: string }>(path: string | null, terminal: readonly string[], startedAt: number) {
  const isTerminal = (status?: string) => status !== undefined && terminal.includes(status);
  return useQuery({
    queryKey: ["settlement", path],
    queryFn: () => api<T>(path!),
    enabled: path !== null,
    refetchInterval: (q) =>
      isTerminal(q.state.data?.status) || Date.now() - startedAt > SETTLE_TIMEOUT_MS ? false : SETTLE_POLL_MS,
    gcTime: 0,
  });
}

interface PreparedFlowOptions<K extends string> {
  path: "/api/orders" | "/api/transfers";
  idKey: K;
  body: Record<string, string>;
  ready: boolean;
  // Each prepare creates a real order or transfer upstream; only a price that moves is worth re-quoting.
  refresh: boolean;
  terminal: readonly string[];
  success: string;
}

export function usePreparedFlow<K extends string, Prepared extends Record<K, string>, Detail extends { status: string }>({
  path,
  idKey,
  body,
  ready,
  refresh,
  terminal,
  success,
}: PreparedFlowOptions<K>) {
  const queryClient = useQueryClient();
  const [executed, setExecuted] = useState<{ id: string; startedAt: number } | null>(null);

  const execute = useMutation({
    mutationFn: (id: string) => api<Record<K, string>>(`${path}/${encodeURIComponent(id)}/execute`, { method: "POST" }),
    onSuccess: (res) => setExecuted({ id: res[idKey], startedAt: Date.now() }),
  });
  const quote = useLiveQuote<Prepared>(path, body, ready && execute.isIdle && executed === null, refresh);
  const settlement = useSettlement<Detail>(
    executed && `${path}/${encodeURIComponent(executed.id)}`,
    terminal,
    executed?.startedAt ?? 0,
  );

  const status = settlement.data?.status;
  const [, setDeadlinePassed] = useState(false);
  useEffect(() => {
    setDeadlinePassed(false);
    if (!executed) return;
    const timer = setTimeout(() => setDeadlinePassed(true), executed.startedAt + SETTLE_TIMEOUT_MS + 1 - Date.now());
    return () => clearTimeout(timer);
  }, [executed]);
  useEffect(() => {
    if (status !== success) return;
    void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    void queryClient.invalidateQueries({ queryKey: ["transactions"] });
  }, [status, success, queryClient]);

  return {
    quote,
    settlement,
    flow: settlementState({
      signing: execute.isPending,
      startedAt: executed?.startedAt ?? null,
      status,
      terminal,
      success,
      now: Date.now(),
    }),
    executeError: execute.error,
    canConfirm: quote.data !== undefined && !quote.isError && !quote.isFetching && execute.isIdle,
    confirm: () => quote.data && execute.mutate(quote.data[idKey]),
    reset: () => {
      setExecuted(null);
      execute.reset();
    },
    retry: () => {
      execute.reset();
      void quote.refetch();
    },
  };
}
