import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deps, TM_API_URL } from "./client.ts";
import * as gateway from "./gateway.ts";

const USER = "0e7c5a52-3a8b-4d6e-9f10-2b3c4d5e6f70";
const ASSET = "5f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";

const original = { ...deps };
let fetchMock: ReturnType<typeof vi.fn<typeof deps.fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof deps.fetch>(async () => new Response("{}", { status: 200 }));
  deps.fetch = fetchMock;
  deps.mintOrgToken = async () => "org-token";
  deps.organizationId = async () => "org-1";
});

afterEach(() => {
  Object.assign(deps, original);
});

interface Case {
  name: string;
  call: () => Promise<unknown>;
  method: string;
  path: string;
  authorized: boolean;
  onBehalfOf?: string;
  body?: unknown;
}

const cases: Case[] = [
  {
    name: "createOrganizationUser",
    call: () => gateway.createOrganizationUser("cust_1", "02ab"),
    method: "POST",
    path: "/v1/account/organizations/org-1/users",
    authorized: true,
    body: { external_ref_id: "cust_1", signer_public_key: "02ab" },
  },
  {
    name: "listAssets",
    call: () => gateway.listAssets(),
    method: "GET",
    path: "/v1/gateway/assets?venue=defi&limit=100",
    authorized: false,
  },
  {
    name: "priceHistory",
    call: () => gateway.priceHistory("SOL"),
    method: "GET",
    path: "/v1/defi/market/prices/history?symbol=SOL&window=24h&resolution=5m",
    authorized: false,
  },
  {
    name: "portfolio",
    call: () => gateway.portfolio(USER),
    method: "GET",
    path: "/v1/gateway/portfolio",
    authorized: true,
    onBehalfOf: USER,
  },
  {
    name: "balances",
    call: () => gateway.balances(USER),
    method: "GET",
    path: "/v1/gateway/balances",
    authorized: true,
    onBehalfOf: USER,
  },
  {
    name: "createOrder",
    call: () => gateway.createOrder(USER, { asset_id: ASSET, chain: "solana", side: "buy", qty: "1.20", qty_unit: "quote" }),
    method: "POST",
    path: "/v1/gateway/orders",
    authorized: true,
    onBehalfOf: USER,
    body: { asset_id: ASSET, chain: "solana", side: "buy", qty: "1.20", qty_unit: "quote", type: "market" },
  },
  {
    name: "executeOrder",
    call: () => gateway.executeOrder(USER, "ord-1", ["s1", "s2"]),
    method: "POST",
    path: "/v1/gateway/orders/ord-1/execute",
    authorized: true,
    onBehalfOf: USER,
    body: { signatures: ["s1", "s2"], auth_type: "api_key" },
  },
  {
    name: "getOrder",
    call: () => gateway.getOrder(USER, "ord-1"),
    method: "GET",
    path: "/v1/gateway/orders/ord-1",
    authorized: true,
    onBehalfOf: USER,
  },
  {
    name: "createTransfer",
    call: () => gateway.createTransfer(USER, { asset_id: ASSET, qty: "0.01", to: "addr" }),
    method: "POST",
    path: "/v1/gateway/transfers",
    authorized: true,
    onBehalfOf: USER,
    body: { asset_id: ASSET, qty: "0.01", to: "addr", qty_unit: "base" },
  },
  {
    name: "executeTransfer",
    call: () => gateway.executeTransfer(USER, "tr-1", ["s1"]),
    method: "POST",
    path: "/v1/gateway/transfers/tr-1/execute",
    authorized: true,
    onBehalfOf: USER,
    body: { signatures: ["s1"], auth_type: "api_key" },
  },
  {
    name: "getTransfer",
    call: () => gateway.getTransfer(USER, "tr-1"),
    method: "GET",
    path: "/v1/gateway/transfers/tr-1",
    authorized: true,
    onBehalfOf: USER,
  },
  {
    name: "listTransactions",
    call: () => gateway.listTransactions(USER),
    method: "GET",
    path: "/v1/gateway/transactions?limit=50",
    authorized: true,
    onBehalfOf: USER,
  },
];

it.each(cases)("$name", async (tc) => {
  await tc.call();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0]!;
  const headers = init!.headers as Record<string, string>;
  expect(url).toBe(`${TM_API_URL}${tc.path}`);
  expect(init!.method).toBe(tc.method);
  expect(headers.Authorization).toBe(tc.authorized ? "Bearer org-token" : undefined);
  expect(headers["TM-On-Behalf-Of"]).toBe(tc.onBehalfOf);
  expect(init!.body === undefined ? undefined : JSON.parse(init!.body as string)).toEqual(tc.body);
});
