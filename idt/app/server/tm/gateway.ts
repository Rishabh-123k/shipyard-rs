import { deps, tmFetch } from "./client.ts";
import type {
  AssetItem,
  BalancesResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  CreateTransferRequest,
  ExecuteOrderResponse,
  OrderDetail,
  OrganizationUser,
  Page,
  PortfolioResponse,
  PriceHistoryResponse,
  TransactionDetail,
  TransferDetail,
} from "./types.ts";

const GATEWAY = "/v1/gateway";

export async function createOrganizationUser(externalRefId: string, signerPublicKey: string): Promise<OrganizationUser> {
  return tmFetch(`/v1/account/organizations/${await deps.organizationId()}/users`, {
    method: "POST",
    body: { external_ref_id: externalRefId, signer_public_key: signerPublicKey },
  });
}

export function listAssets(): Promise<Page<AssetItem>> {
  return tmFetch(`${GATEWAY}/assets?venue=defi&limit=100`, { auth: "none" });
}

export function priceHistory(symbol: string): Promise<PriceHistoryResponse> {
  const query = new URLSearchParams({ symbol, window: "24h", resolution: "5m" });
  return tmFetch(`/v1/defi/market/prices/history?${query}`, { auth: "none" });
}

export function portfolio(userId: string): Promise<PortfolioResponse> {
  return tmFetch(`${GATEWAY}/portfolio`, { onBehalfOf: userId });
}

export function balances(userId: string): Promise<BalancesResponse> {
  return tmFetch(`${GATEWAY}/balances`, { onBehalfOf: userId });
}

export function createOrder(userId: string, order: CreateOrderRequest): Promise<CreateOrderResponse> {
  return tmFetch(`${GATEWAY}/orders`, {
    method: "POST",
    onBehalfOf: userId,
    body: { ...order, type: "market" },
  });
}

export function executeOrder(userId: string, orderId: string, signatures: string[]): Promise<ExecuteOrderResponse> {
  return tmFetch(`${GATEWAY}/orders/${encodeURIComponent(orderId)}/execute`, {
    method: "POST",
    onBehalfOf: userId,
    body: { signatures, auth_type: "api_key" },
  });
}

export function getOrder(userId: string, orderId: string): Promise<OrderDetail> {
  return tmFetch(`${GATEWAY}/orders/${encodeURIComponent(orderId)}`, { onBehalfOf: userId });
}

export function createTransfer(userId: string, transfer: CreateTransferRequest): Promise<TransferDetail> {
  return tmFetch(`${GATEWAY}/transfers`, {
    method: "POST",
    onBehalfOf: userId,
    body: { ...transfer, qty_unit: "base" },
  });
}

export function executeTransfer(userId: string, transferId: string, signatures: string[]): Promise<TransferDetail> {
  return tmFetch(`${GATEWAY}/transfers/${encodeURIComponent(transferId)}/execute`, {
    method: "POST",
    onBehalfOf: userId,
    body: { signatures, auth_type: "api_key" },
  });
}

export function getTransfer(userId: string, transferId: string): Promise<TransferDetail> {
  return tmFetch(`${GATEWAY}/transfers/${encodeURIComponent(transferId)}`, { onBehalfOf: userId });
}

export function listTransactions(userId: string): Promise<Page<TransactionDetail>> {
  return tmFetch(`${GATEWAY}/transactions?limit=50`, { onBehalfOf: userId });
}
