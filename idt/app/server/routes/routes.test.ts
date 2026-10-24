import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetCatalog } from "../assets.ts";
import type { PriceBook, PriceQuote } from "../prices.ts";
import { TMError } from "../tm/errors.ts";
import type * as gatewayModule from "../tm/gateway.ts";
import { signerPublicKeyCompressedHex } from "../tm/stamp.ts";
import { assetItem, verifiesStamp } from "../testing.ts";
import type { CreateOrderResponse, OrganizationUser, TransactionDetail, TransferDetail } from "../tm/types.ts";

type Gateway = typeof gatewayModule;
type OrderDetail = Awaited<ReturnType<Gateway["getOrder"]>>;

const SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OTHER_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const EVM_ADDRESS = "0x3fA9b1C47e0D2a8F5E6c9B04d71A2F8e5b3Cc21E";

const SOL = assetItem("SOL");
const PENGU = assetItem("PENGU");
const USDC = assetItem("USDC");
const AERO = assetItem("AERO", "base");
const BASE_USDC = assetItem("USDC", "base");
const ORDER = { asset_id: PENGU.id, side: "buy", amount: "1.20" };
const TRANSFER = { asset_id: SOL.id, qty: "0.01", to: SOLANA_ADDRESS };
const ALL = [SOL, PENGU, AERO, USDC, BASE_USDC];

const catalog: AssetCatalog = {
  byId: (id) => ALL.find((a) => a.id === id),
  symbolOf: (address) => ALL.find((a) => a.address === address)?.symbol ?? address,
  tradeable: () => [SOL, PENGU, AERO],
  isCash: (asset) => asset === USDC || asset === BASE_USDC,
  all: () => ALL,
};

const priceBook: PriceBook = {
  get: (symbol): PriceQuote =>
    symbol === "SOL"
      ? { price: "150.25", change_24h: "0.0310", as_of: "2026-09-24T10:00:00Z" }
      : { price: null, change_24h: null, as_of: null },
};

function organizationUser(externalRefId: string): OrganizationUser {
  return {
    user_id: `user-${externalRefId}`,
    external_ref_id: externalRefId,
    created_at: "2026-09-24T10:00:00Z",
    wallets: [
      { chain_family: "solana", address: SOLANA_ADDRESS },
      { chain_family: "evm", address: "0x3fA9b1C47e0D2a8F5E6c9B04d71A2F8e5b3Cc21E" },
    ],
  };
}

function preparedOrder(orderId: string): CreateOrderResponse {
  return {
    order_id: orderId,
    status: "initialized",
    payloads: [
      { digest: "d1", payload: `${orderId}-payload-1` },
      { digest: "d2", payload: `${orderId}-payload-2` },
    ],
    quote: {
      base_asset: PENGU.address!,
      quote_asset: USDC.address!,
      qty: "1.20",
      qty_out: "40.1",
      fee: "0.0024",
      fee_asset: USDC.address!,
    },
  };
}

function preparedTransfer(id: string): TransferDetail {
  return {
    id,
    status: "awaiting_signature",
    venue: "defi",
    asset_id: SOL.id,
    asset_symbol: "SOL",
    chain: "solana",
    network: null,
    to: SOLANA_ADDRESS,
    qty: "0.01",
    qty_unit: "base",
    sent: "0",
    fee: "0",
    received: "0",
    tx_hash: "",
    explorer_url: null,
    payloads: [{ digest: "d1", payload: `${id}-payload-1` }],
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T10:00:00Z",
  };
}

function fakeGateway() {
  return {
    createOrganizationUser: vi.fn<Gateway["createOrganizationUser"]>(async (ref) => organizationUser(ref)),
    listAssets: vi.fn<Gateway["listAssets"]>(),
    priceHistory: vi.fn<Gateway["priceHistory"]>(),
    portfolio: vi.fn<Gateway["portfolio"]>(),
    balances: vi.fn<Gateway["balances"]>(),
    createOrder: vi.fn<Gateway["createOrder"]>(async () => preparedOrder("order-1")),
    executeOrder: vi.fn<Gateway["executeOrder"]>(async () => ({ status: "pending" })),
    getOrder: vi.fn<Gateway["getOrder"]>(),
    createTransfer: vi.fn<Gateway["createTransfer"]>(async () => preparedTransfer("transfer-1")),
    executeTransfer: vi.fn<Gateway["executeTransfer"]>(async () => ({
      ...preparedTransfer("transfer-1"),
      status: "pending",
      payloads: [],
    })),
    getTransfer: vi.fn<Gateway["getTransfer"]>(),
    listTransactions: vi.fn<Gateway["listTransactions"]>(),
  } satisfies Gateway;
}

let createApp: typeof import("../app.ts").createApp;
let gateway: ReturnType<typeof fakeGateway>;
let app: Hono;
let emailCounter = 0;

beforeAll(async () => {
  vi.stubEnv("DATA_FILE", join(mkdtempSync(join(tmpdir(), "tensho-routes-")), "customers.json"));
  ({ createApp } = await import("../app.ts"));
});

function freshApp(guard = { dryRun: false, maxOrderUsd: 1_000_000 }) {
  gateway = fakeGateway();
  app = createApp({ gateway, assets: catalog, prices: priceBook, guard });
}

afterEach(() => {
  vi.useRealTimers();
});

function post(path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie?: string) {
  return app.request(path, { headers: cookie ? { Cookie: cookie } : {} });
}

function sessionCookie(res: Response): string {
  const header = res.headers.get("Set-Cookie") ?? "";
  return header.split(";")[0]!;
}

async function signUp(): Promise<{ cookie: string; email: string }> {
  const email = `customer${++emailCounter}@example.com`;
  const res = await post("/api/signup", { email, password: "password123" });
  expect(res.status).toBe(201);
  return { cookie: sessionCookie(res), email };
}

describe("auth routes", () => {
  beforeEach(freshApp);

  it("signs up, seats a gateway user and sets the session cookie", async () => {
    const res = await post("/api/signup", { email: "Maya@Example.com", password: "password123" });

    expect(res.status).toBe(201);
    expect(res.headers.get("Set-Cookie")).toMatch(/^tensho_session=.+HttpOnly/);
    const body = (await res.json()) as { email: string; wallets: unknown[]; ready: boolean };
    expect(body).toMatchObject({ email: "maya@example.com", ready: true });
    expect(body.wallets).toHaveLength(2);
    const [ref, signerKey] = gateway.createOrganizationUser.mock.calls[0]!;
    expect(ref).toMatch(/^cust_/);
    expect(signerKey).toBe(signerPublicKeyCompressedHex);
  });

  it("keeps a customer whose wallet step failed and finishes it on the next login", async () => {
    gateway.createOrganizationUser.mockRejectedValueOnce(
      new TMError(503, { type: "unavailable", message: "wallet service unavailable" }),
    );

    const signup = await post("/api/signup", { email: "retry@example.com", password: "password123" });
    const notReady = await get("/api/portfolio", sessionCookie(signup));
    const login = await post("/api/login", { email: "retry@example.com", password: "password123" });

    expect(signup.status).toBe(201);
    expect(await signup.json()).toMatchObject({ ready: false, warning: "wallet service unavailable" });
    expect(notReady.status).toBe(409);
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ ready: true });
    const [first, second] = gateway.createOrganizationUser.mock.calls;
    expect(second).toEqual(first);
  });

  it("rejects a wrong password", async () => {
    const { email } = await signUp();

    const res = await post("/api/login", { email, password: "not-the-password" });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ type: "unauthenticated" });
  });

  it("rejects a session-only route without the cookie", async () => {
    const res = await get("/api/portfolio");

    expect(res.status).toBe(401);
    expect(gateway.portfolio).not.toHaveBeenCalled();
  });

  it.each([
    ["an unsigned cookie", () => "tensho_session=some-customer-id"],
    ["a tampered signature", (cookie: string) => cookie.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"))],
  ])("rejects %s", async (_, forge) => {
    const { cookie } = await signUp();

    const res = await get("/api/portfolio", forge(cookie));

    expect(res.status).toBe(401);
    expect(gateway.portfolio).not.toHaveBeenCalled();
  });

  it("answers an unknown API path with a JSON 404", async () => {
    const res = await get("/api/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ type: "not_found" });
  });

  it("refuses a second account for the same email", async () => {
    const { email } = await signUp();

    const res = await post("/api/signup", { email: email.toUpperCase(), password: "password123" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ type: "already_exists" });
    expect(gateway.createOrganizationUser).toHaveBeenCalledTimes(1);
  });

  it("signs a seated customer in without creating the gateway user again", async () => {
    const { email } = await signUp();

    const res = await post("/api/login", { email, password: "password123" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email, ready: true });
    expect(res.headers.get("Set-Cookie")).toMatch(/^tensho_session=/);
    expect(gateway.createOrganizationUser).toHaveBeenCalledTimes(1);
  });

  it("clears the session cookie on logout", async () => {
    const { cookie } = await signUp();

    const res = await post("/api/logout", {}, cookie);

    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toMatch(/^tensho_session=;.*Max-Age=0/);
  });
});

describe("wallet routes", () => {
  let cookie: string;

  beforeEach(async () => {
    freshApp();
    ({ cookie } = await signUp());
  });

  it("relays the portfolio", async () => {
    const portfolio = { total_usd: "12.5", balances: [] } as unknown as Awaited<ReturnType<Gateway["portfolio"]>>;
    gateway.portfolio.mockResolvedValueOnce(portfolio);

    const res = await get("/api/portfolio", cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(portfolio);
  });

  it("falls back to unpriced balances when the portfolio is unavailable", async () => {
    const balances = [{ symbol: "USDC", total: "3" }] as unknown as Awaited<ReturnType<Gateway["balances"]>>["data"];
    gateway.portfolio.mockRejectedValueOnce(new TMError(503, { type: "unavailable", message: "pricing down" }));
    gateway.balances.mockResolvedValueOnce({ data: balances });

    const res = await get("/api/portfolio", cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ priced: false, balances });
  });

  it("relays a portfolio error other than 503 instead of falling back", async () => {
    const raw = '{"type":"internal","message":"internal server error","request_id":"req-2"}';
    gateway.portfolio.mockRejectedValueOnce(new TMError(500, JSON.parse(raw), raw));

    const res = await get("/api/portfolio", cookie);

    expect(res.status).toBe(500);
    expect(await res.text()).toBe(raw);
    expect(gateway.balances).not.toHaveBeenCalled();
  });

  it("lists signed activity and leaves out transfers that were prepared but never signed", async () => {
    const row = (id: string, status: string) =>
      ({ id, type: "transfer", status: "pending", transfer: { ...preparedTransfer(id), status } }) as unknown as TransactionDetail;
    const order = { id: "o-1", type: "order", status: "completed" } as unknown as TransactionDetail;
    gateway.listTransactions.mockResolvedValueOnce({
      data: [row("t-unsigned", "awaiting_signature"), row("t-landing", "pending"), row("t-done", "completed"), order],
      pagination: { next_cursor: null, limit: 50 },
    });

    const res = await get("/api/transactions", cookie);

    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((tx) => tx.id)).toEqual(["t-landing", "t-done", "o-1"]);
  });

  it("lists the tradeable tokens and cash with polled prices", async () => {
    const res = await get("/api/assets", cookie);

    const rows = (await res.json()) as { symbol: string; price: string | null; change_24h: string | null; cash: boolean }[];
    expect(rows.map((r) => r.symbol)).toEqual(["SOL", "PENGU", "AERO", "USDC", "USDC"]);
    expect(rows[0]).toMatchObject({ price: "150.25", change_24h: "0.0310" });
    expect(rows[1]).toMatchObject({ price: null, change_24h: null });
    expect(rows.filter((r) => r.cash).map((r) => r.symbol)).toEqual(["USDC", "USDC"]);
  });
});

describe("order routes", () => {
  let cookie: string;

  beforeEach(async () => {
    freshApp();
    ({ cookie } = await signUp());
  });

  it("prepares a buy in quote units and returns the quote", async () => {
    const res = await post("/api/orders", ORDER, cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { order_id: string; quote: unknown; prepared_at: string };
    expect(body.order_id).toBe("order-1");
    expect(body.quote).toEqual({
      base_asset: "PENGU",
      quote_asset: "USDC",
      qty: "1.20",
      qty_out: "40.1",
      fee: "0.0024",
      fee_asset: "USDC",
    });
    expect(Date.parse(body.prepared_at)).not.toBeNaN();
    expect(body).not.toHaveProperty("payloads");
    expect(gateway.createOrder.mock.calls[0]![1]).toEqual({
      asset_id: PENGU.id,
      chain: "solana",
      side: "buy",
      qty: "1.20",
      qty_unit: "quote",
    });
  });

  it("places a Base token's order on the Base chain", async () => {
    await post("/api/orders", { ...ORDER, asset_id: AERO.id }, cookie);

    expect(gateway.createOrder.mock.calls[0]![1]).toMatchObject({ asset_id: AERO.id, chain: "base" });
  });

  it("refuses to trade a cash asset", async () => {
    const res = await post("/api/orders", { ...ORDER, asset_id: BASE_USDC.id }, cookie);

    expect(res.status).toBe(400);
    expect(gateway.createOrder).not.toHaveBeenCalled();
  });

  it("prepares a sell in base units", async () => {
    await post("/api/orders", { ...ORDER, side: "sell", amount: "40.1" }, cookie);

    expect(gateway.createOrder.mock.calls[0]![1]).toMatchObject({ side: "sell", qty: "40.1", qty_unit: "base" });
  });

  it("refuses a quote that carries issues and caches nothing", async () => {
    const withIssue = preparedOrder("order-issue");
    withIssue.quote!.issues = ["insufficient balance"];
    gateway.createOrder.mockResolvedValueOnce(withIssue);

    const res = await post("/api/orders", ORDER, cookie);
    const execute = await post("/api/orders/order-issue/execute", {}, cookie);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ type: "failed_precondition", message: "insufficient balance" });
    expect(execute.status).toBe(409);
  });

  it("executes a fresh quote with index-aligned stamps of the cached payloads", async () => {
    await post("/api/orders", ORDER, cookie);

    const res = await post("/api/orders/order-1/execute", {}, cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ order_id: "order-1", status: "pending" });
    expect(gateway.createOrder).toHaveBeenCalledTimes(1);
    const [, orderId, signatures] = gateway.executeOrder.mock.calls[0]!;
    expect(orderId).toBe("order-1");
    expect(signatures).toHaveLength(2);
    expect(verifiesStamp(signatures[0]!, "order-1-payload-1")).toBe(true);
    expect(verifiesStamp(signatures[1]!, "order-1-payload-2")).toBe(true);
  });

  it("re-prepares a quote older than 20 seconds and executes the new order", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await post("/api/orders", ORDER, cookie);
    gateway.createOrder.mockResolvedValueOnce(preparedOrder("order-2"));

    vi.setSystemTime(Date.now() + 21_000);
    const res = await post("/api/orders/order-1/execute", {}, cookie);

    expect(await res.json()).toEqual({ order_id: "order-2", status: "pending" });
    expect(gateway.createOrder).toHaveBeenCalledTimes(2);
    expect(gateway.createOrder.mock.calls[1]).toEqual(gateway.createOrder.mock.calls[0]);
    const [, orderId, signatures] = gateway.executeOrder.mock.calls[0]!;
    expect(orderId).toBe("order-2");
    expect(verifiesStamp(signatures[0]!, "order-2-payload-1")).toBe(true);
  });

  it("refuses a stale quote whose fresh prepare carries issues, signing nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await post("/api/orders", ORDER, cookie);
    const withIssue = preparedOrder("order-2");
    withIssue.quote!.issues = ["insufficient balance"];
    gateway.createOrder.mockResolvedValueOnce(withIssue);

    vi.setSystemTime(Date.now() + 21_000);
    const res = await post("/api/orders/order-1/execute", {}, cookie);

    expect(res.status).toBe(422);
    expect(gateway.executeOrder).not.toHaveBeenCalled();
  });

  it("refuses a prepare that returns nothing to sign and caches nothing", async () => {
    gateway.createOrder.mockResolvedValueOnce({ ...preparedOrder("order-empty"), payloads: [] });

    const res = await post("/api/orders", ORDER, cookie);
    const execute = await post("/api/orders/order-empty/execute", {}, cookie);

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ type: "unavailable" });
    expect(execute.status).toBe(409);
  });

  it("builds the explorer link conductor omits on a single-order read", async () => {
    const detail = { order_id: "order-1", status: "complete", asset_id: PENGU.id, tx_hash: "sig1" } as unknown as OrderDetail;
    gateway.getOrder.mockResolvedValueOnce(detail);

    const res = await get("/api/orders/order-1", cookie);

    expect(await res.json()).toEqual({ ...detail, explorer_url: "https://solscan.io/tx/sig1" });
    expect(gateway.getOrder.mock.calls[0]![1]).toBe("order-1");
  });

  it("keeps the explorer link conductor returns", async () => {
    const detail = {
      order_id: "order-1",
      asset_id: PENGU.id,
      tx_hash: "sig1",
      explorer_url: "https://explorer.example/tx/sig1",
    } as unknown as OrderDetail;
    gateway.getOrder.mockResolvedValueOnce(detail);

    const res = await get("/api/orders/order-1", cookie);

    expect(await res.json()).toEqual(detail);
  });

  it("leaves the explorer link out of an order that has no transaction yet", async () => {
    gateway.getOrder.mockResolvedValueOnce({ order_id: "order-1", asset_id: PENGU.id } as unknown as OrderDetail);

    const res = await get("/api/orders/order-1", cookie);

    expect(await res.json()).not.toHaveProperty("explorer_url");
  });

  it("answers a second execute of the same quote with 409", async () => {
    await post("/api/orders", ORDER, cookie);
    await post("/api/orders/order-1/execute", {}, cookie);

    const res = await post("/api/orders/order-1/execute", {}, cookie);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ type: "failed_precondition", code: "quote_stale", message: "quote expired, review again" });
    expect(gateway.executeOrder).toHaveBeenCalledTimes(1);
  });

  it("never executes a quote prepared for another customer", async () => {
    const other = await signUp();
    await post("/api/orders", ORDER, cookie);

    const res = await post("/api/orders/order-1/execute", {}, other.cookie);

    expect(res.status).toBe(409);
    expect(gateway.executeOrder).not.toHaveBeenCalled();
  });

  it("relays a True Markets error with its status and bytes unchanged", async () => {
    const raw = '{"type":"failed_precondition","code":"quote_stale","message":"quote expired before it landed","request_id":"req-1"}';
    gateway.executeOrder.mockRejectedValueOnce(new TMError(422, JSON.parse(raw), raw));
    await post("/api/orders", ORDER, cookie);

    const res = await post("/api/orders/order-1/execute", {}, cookie);

    expect(res.status).toBe(422);
    expect(await res.text()).toBe(raw);
  });

  it("rejects an amount that is not a positive decimal", async () => {
    const res = await post("/api/orders", { ...ORDER, amount: "0" }, cookie);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ type: "invalid_argument" });
    expect(gateway.createOrder).not.toHaveBeenCalled();
  });
});

describe("transfer routes", () => {
  let cookie: string;

  beforeEach(async () => {
    freshApp();
    ({ cookie } = await signUp());
  });

  it.each([
    ["a Solana asset to an EVM address", { ...TRANSFER, to: EVM_ADDRESS }],
    ["a Base asset to a Solana address", { asset_id: BASE_USDC.id, qty: "1", to: SOLANA_ADDRESS }],
  ])("refuses to send %s without calling True Markets", async (_, body) => {
    const res = await post("/api/transfers", body, cookie);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ type: "invalid_argument" });
    expect(gateway.createTransfer).not.toHaveBeenCalled();
  });

  it("sends a Base asset to an EVM address", async () => {
    gateway.createTransfer.mockResolvedValueOnce({ ...preparedTransfer("transfer-base"), chain: "base" });

    const res = await post("/api/transfers", { asset_id: BASE_USDC.id, qty: "1", to: EVM_ADDRESS }, cookie);

    expect(res.status).toBe(200);
    expect(gateway.createTransfer.mock.calls[0]![1]).toEqual({ asset_id: BASE_USDC.id, qty: "1", to: EVM_ADDRESS });
  });

  it("relays a transfer's detail", async () => {
    const detail = preparedTransfer("transfer-1");
    gateway.getTransfer.mockResolvedValueOnce(detail);

    const res = await get("/api/transfers/transfer-1", cookie);

    expect(await res.json()).toEqual(detail);
    expect(gateway.getTransfer.mock.calls[0]![1]).toBe("transfer-1");
  });

  it("prepares and executes a send with stamps of the cached payloads", async () => {
    const prepared = await post("/api/transfers", TRANSFER, cookie);
    const executed = await post("/api/transfers/transfer-1/execute", {}, cookie);

    expect(await prepared.json()).toMatchObject({ transfer_id: "transfer-1", qty: "0.01", fee: "0" });
    expect(gateway.createTransfer.mock.calls[0]![1]).toEqual({ asset_id: SOL.id, qty: "0.01", to: SOLANA_ADDRESS });
    expect(await executed.json()).toEqual({ transfer_id: "transfer-1", status: "pending" });
    const [, transferId, signatures] = gateway.executeTransfer.mock.calls[0]!;
    expect(transferId).toBe("transfer-1");
    expect(signatures).toHaveLength(1);
    expect(verifiesStamp(signatures[0]!, "transfer-1-payload-1")).toBe(true);
  });

  it("re-prepares a stale send from the reviewed request, never from the execute body", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await post("/api/transfers", TRANSFER, cookie);
    gateway.createTransfer.mockResolvedValueOnce(preparedTransfer("transfer-2"));

    vi.setSystemTime(Date.now() + 21_000);
    const res = await post("/api/transfers/transfer-1/execute", { ...TRANSFER, to: OTHER_ADDRESS }, cookie);

    expect(await res.json()).toEqual({ transfer_id: "transfer-2", status: "pending" });
    expect(gateway.createTransfer).toHaveBeenCalledTimes(2);
    expect(gateway.createTransfer.mock.calls[1]![1]).toMatchObject({ to: SOLANA_ADDRESS });
    const [, transferId, signatures] = gateway.executeTransfer.mock.calls[0]!;
    expect(transferId).toBe("transfer-2");
    expect(verifiesStamp(signatures[0]!, "transfer-2-payload-1")).toBe(true);
  });
});

describe("trade guard", () => {
  let cookie: string;

  async function withGuard(guard: { dryRun: boolean; maxOrderUsd: number }) {
    freshApp(guard);
    ({ cookie } = await signUp());
  }

  it("quotes but never signs or executes an order under DRY_RUN", async () => {
    await withGuard({ dryRun: true, maxOrderUsd: 10 });
    expect((await post("/api/orders", ORDER, cookie)).status).toBe(200);

    const res = await post("/api/orders/order-1/execute", {}, cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "dry_run" });
    expect(gateway.executeOrder).not.toHaveBeenCalled();
  });

  it("never executes a send under DRY_RUN", async () => {
    await withGuard({ dryRun: true, maxOrderUsd: 10 });
    await post("/api/transfers", { asset_id: BASE_USDC.id, qty: "1", to: EVM_ADDRESS }, cookie);

    const res = await post("/api/transfers/transfer-1/execute", {}, cookie);

    expect(res.status).toBe(403);
    expect(gateway.executeTransfer).not.toHaveBeenCalled();
  });

  it("rejects a buy over the cap before creating anything upstream", async () => {
    await withGuard({ dryRun: false, maxOrderUsd: 1 });

    const res = await post("/api/orders", ORDER, cookie);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "over_cap" });
    expect(gateway.createOrder).not.toHaveBeenCalled();
  });

  it("rejects a sell whose quoted proceeds exceed the cap and caches nothing", async () => {
    await withGuard({ dryRun: false, maxOrderUsd: 10 });

    const res = await post("/api/orders", { ...ORDER, side: "sell", amount: "40.1" }, cookie);
    const execute = await post("/api/orders/order-1/execute", {}, cookie);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "over_cap" });
    expect(execute.status).toBe(409);
    expect(gateway.executeOrder).not.toHaveBeenCalled();
  });

  it("allows an order inside the cap", async () => {
    await withGuard({ dryRun: false, maxOrderUsd: 10 });
    await post("/api/orders", ORDER, cookie);

    expect((await post("/api/orders/order-1/execute", {}, cookie)).status).toBe(200);
  });
});
