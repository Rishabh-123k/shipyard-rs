import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteCache } from "./pending.ts";

const PAYLOADS = [{ digest: "d1", payload: "p1" }];
const REQUEST = { symbol: "PENGU", amount: "1.20" };

let cache: QuoteCache<typeof REQUEST>;

beforeEach(() => {
  cache = new QuoteCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("QuoteCache.take", () => {
  it("hands an entry out once", () => {
    cache.put("o-1", "cust-1", REQUEST, PAYLOADS);

    const first = cache.take("o-1", "cust-1");
    const second = cache.take("o-1", "cust-1");

    expect(first).toMatchObject({ request: REQUEST, payloads: PAYLOADS, preparedAt: expect.any(Number) });
    expect(second).toBeUndefined();
  });

  it("never hands an entry to another customer", () => {
    cache.put("o-1", "cust-1", REQUEST, PAYLOADS);

    expect(cache.take("o-1", "cust-2")).toBeUndefined();
    expect(cache.take("o-1", "cust-1")?.payloads).toEqual(PAYLOADS);
  });

  it("drops an entry older than five minutes", () => {
    vi.useFakeTimers();
    cache.put("o-1", "cust-1", REQUEST, PAYLOADS);

    vi.advanceTimersByTime(5 * 60_000 + 1);

    expect(cache.take("o-1", "cust-1")).toBeUndefined();
  });
});

describe("QuoteCache.signable", () => {
  it("returns the cached payloads of a fresh quote without preparing again", async () => {
    const reprepare = vi.fn();
    cache.put("o-1", "cust-1", REQUEST, PAYLOADS);

    const prepared = await cache.signable("o-1", "cust-1", reprepare);

    expect(prepared).toEqual({ id: "o-1", payloads: PAYLOADS });
    expect(reprepare).not.toHaveBeenCalled();
  });

  it("prepares a stale quote again from the request that was reviewed", async () => {
    vi.useFakeTimers();
    const fresh = { id: "o-2", payloads: [{ digest: "d2", payload: "p2" }] };
    const reprepare = vi.fn(async () => fresh);
    cache.put("o-1", "cust-1", REQUEST, PAYLOADS);

    vi.advanceTimersByTime(20_001);
    const prepared = await cache.signable("o-1", "cust-1", reprepare);

    expect(prepared).toEqual(fresh);
    expect(reprepare).toHaveBeenCalledWith(REQUEST);
  });

  it("answers undefined for a quote it does not hold", async () => {
    expect(await cache.signable("missing", "cust-1", vi.fn())).toBeUndefined();
  });
});
