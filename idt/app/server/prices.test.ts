import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prices, startPricePoller, stopPricePoller } from "./prices.ts";
import type { PriceHistoryResponse } from "./tm/types.ts";

function history(symbol: string, ...values: string[]): PriceHistoryResponse {
  return {
    symbol,
    window: "24h",
    resolution: "5m",
    points: values.map((price, i) => ({ t: `2026-09-24T10:${String(i).padStart(2, "0")}:00Z`, price })),
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  stopPricePoller();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startPricePoller", () => {
  it("serves the last point and the 24h change", async () => {
    const fetchHistory = vi.fn(async (symbol: string) => history(symbol, "100", "104.5", "110"));

    startPricePoller(["SOL"], 15_000, fetchHistory);
    await vi.advanceTimersByTimeAsync(0);

    expect(prices.get("SOL")).toEqual({ price: "110", change_24h: "0.1000", as_of: "2026-09-24T10:02:00Z" });
  });

  it("reads null for a symbol that never priced", async () => {
    const fetchHistory = vi.fn(async (symbol: string) => {
      if (symbol === "PENGU") throw new Error("unavailable");
      return history(symbol);
    });

    startPricePoller(["SOL", "PENGU"], 15_000, fetchHistory);
    await vi.advanceTimersByTimeAsync(0);

    expect(prices.get("SOL")).toEqual({ price: null, change_24h: null, as_of: null });
    expect(prices.get("PENGU")).toEqual({ price: null, change_24h: null, as_of: null });
  });

  it("keeps the previous value through a failure streak and logs it once", async () => {
    const fetchHistory = vi
      .fn<(symbol: string) => Promise<PriceHistoryResponse>>()
      .mockResolvedValueOnce(history("SOL", "100", "110"))
      .mockRejectedValue(new Error("unavailable"));

    startPricePoller(["SOL"], 15_000, fetchHistory);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchHistory).toHaveBeenCalledTimes(3);
    expect(prices.get("SOL").price).toBe("110");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("polls every symbol again after each interval", async () => {
    const fetchHistory = vi.fn(async (symbol: string) => history(symbol, "1", "1"));

    startPricePoller(["SOL", "PENGU", "USDC"], 15_000, fetchHistory);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchHistory).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(fetchHistory).toHaveBeenCalledTimes(6);
    expect(fetchHistory.mock.calls.slice(3).map(([s]) => s)).toEqual(["SOL", "PENGU", "USDC"]);
  });
});
