export interface Page<T> {
  data: T[];
  pagination: { next_cursor: string | null; limit: number };
}

export interface OrganizationUserWallet {
  address: string;
  chain_family: string;
}

export interface OrganizationUser {
  user_id: string;
  external_ref_id: string;
  created_at: string;
  wallets: OrganizationUserWallet[];
}

export interface AssetItem {
  id: string;
  chain: string | null;
  address: string | null;
  symbol: string;
  name: string;
  decimals: number;
  icon: string | null;
  tradeable: boolean;
  stable: boolean;
  venue: string;
}

export interface PricePoint {
  t: string;
  price: string;
}

export interface PriceHistoryResponse {
  asset_id?: string;
  symbol: string;
  window: string;
  resolution: string;
  points: PricePoint[];
}

export interface BalanceItem {
  asset_id?: string;
  symbol: string;
  name: string;
  venue: string;
  chain: string | null;
  address: string | null;
  decimals: number;
  total: string;
  available: string;
  held: string;
  stable: boolean;
  tradeable: boolean;
}

export interface BalancesResponse {
  data: BalanceItem[];
}

export interface PortfolioBalance extends BalanceItem {
  icon: string | null;
  price: string | null;
  value: string | null;
  change_24h_pct: string | null;
}

export interface PortfolioResponse {
  total_usd: string;
  balances_usd: string;
  cash_usd: string;
  change_24h_usd: string;
  change_24h_pct: string;
  unrealized_pnl_usd: string;
  realized_pnl_usd: string;
  balances: PortfolioBalance[];
  positions: unknown[];
}

export type OrderSide = "buy" | "sell";
export type QtyUnit = "base" | "quote";

export interface UnsignedPayload {
  digest: string;
  payload: string;
}

export interface QuoteDetails {
  base_asset: string;
  quote_asset: string;
  qty: string;
  qty_out: string;
  fee: string;
  fee_asset: string;
  issues?: string[];
}

export interface CreateOrderRequest {
  asset_id: string;
  chain: string;
  side: OrderSide;
  qty: string;
  qty_unit: QtyUnit;
}

export interface CreateOrderResponse {
  order_id: string;
  status: string;
  payloads?: UnsignedPayload[];
  quote?: QuoteDetails;
}

export interface ExecuteOrderResponse {
  status: string;
}

export interface OrderDetail {
  order_id: string;
  base_asset: string;
  quote_asset: string;
  asset_id?: string;
  asset_symbol?: string;
  type: string;
  side: OrderSide;
  price: string | null;
  qty: string;
  qty_unit: QtyUnit;
  executed_qty: string;
  leaves_qty: string;
  executed_vwap: string;
  fee: string;
  tx_hash?: string;
  explorer_url?: string;
  failure_reason?: string;
  venue: string;
  status: string;
  created_at: string;
}

export interface CreateTransferRequest {
  asset_id: string;
  qty: string;
  to: string;
}

export interface TransferDetail {
  id: string;
  status: string;
  venue: string;
  asset_id: string;
  asset_symbol: string;
  chain: string | null;
  network: string | null;
  to: string;
  qty: string;
  qty_unit: string;
  sent: string;
  fee: string;
  received: string;
  tx_hash: string;
  explorer_url: string | null;
  payloads: UnsignedPayload[] | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionDetail {
  id: string;
  type: "order" | "transfer" | "ramp";
  asset_flow: "in" | "out";
  status: "pending" | "completed" | "failed" | "canceled";
  created_at: string;
  completed_at: string | null;
  qty: string | null;
  asset_id: string | null;
  asset_symbol: string | null;
  tx_hash: string | null;
  explorer_url: string | null;
  failure_reason: string | null;
  order?: OrderDetail;
  transfer?: TransferDetail;
}
