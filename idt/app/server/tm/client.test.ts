import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deps, TM_API_URL, tmFetch } from "./client.ts";
import { TMError } from "./errors.ts";

const original = { ...deps };
let fetchMock: ReturnType<typeof vi.fn<typeof deps.fetch>>;

function sentHeaders(): Record<string, string> {
  return fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
}

beforeEach(() => {
  fetchMock = vi.fn<typeof deps.fetch>(async () => new Response("{}", { status: 200 }));
  deps.fetch = fetchMock;
  deps.mintOrgToken = async () => "org-token";
});

afterEach(() => {
  Object.assign(deps, original);
});

describe("tmFetch", () => {
  it("prefixes the base URL and sends the org token", async () => {
    await tmFetch("/v1/gateway/balances");

    expect(fetchMock.mock.calls[0]![0]).toBe(`${TM_API_URL}/v1/gateway/balances`);
    expect(sentHeaders().Authorization).toBe("Bearer org-token");
  });

  it("sends TM-On-Behalf-Of only when acting as a user", async () => {
    await tmFetch("/v1/gateway/balances", { onBehalfOf: "user-1" });
    await tmFetch("/v1/gateway/assets");

    expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>)["TM-On-Behalf-Of"]).toBe("user-1");
    expect(fetchMock.mock.calls[1]![1]!.headers).not.toHaveProperty("TM-On-Behalf-Of");
  });

  it("sends no Authorization for a public call", async () => {
    await tmFetch("/v1/gateway/assets", { auth: "none" });

    expect(sentHeaders()).not.toHaveProperty("Authorization");
  });

  it("JSON-encodes the body", async () => {
    await tmFetch("/v1/gateway/orders", { method: "POST", body: { qty: "1.5" } });

    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"qty":"1.5"}');
    expect(sentHeaders()["Content-Type"]).toBe("application/json");
  });

  it("throws the upstream envelope unchanged", async () => {
    const raw = JSON.stringify({ type: "failed_precondition", code: "quote_stale", message: "x", request_id: "r" });
    fetchMock.mockResolvedValueOnce(new Response(raw, { status: 422 }));

    const err = await tmFetch("/v1/gateway/orders/1/execute").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TMError);
    expect(err).toMatchObject({ status: 422, body: JSON.parse(raw), raw });
  });

  it("reports a network failure as True Markets being unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const err = await tmFetch("/v1/gateway/portfolio").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TMError);
    expect(err).toMatchObject({ status: 502, body: { type: "unavailable" } });
  });

  it("wraps a non-JSON error body as internal", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));

    const err = await tmFetch("/v1/gateway/portfolio").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TMError);
    expect(err).toMatchObject({ status: 502, body: { type: "internal", message: "bad gateway" } });
  });
});
