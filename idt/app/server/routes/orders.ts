import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { explorerTxUrl } from "../explorer.ts";
import { ApiError, dryRunBlocked, nothingToSign, parseJson, positiveDecimal, quoteExpired } from "../http.ts";
import { QuoteCache } from "../pending.ts";
import { gatewayUserId, requireCustomer, type AppEnv } from "../session.ts";
import { stampAll } from "../tm/stamp.ts";

const orderBody = z.object({
  asset_id: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  amount: positiveDecimal,
});

type OrderBody = z.infer<typeof orderBody>;

export function orderRoutes({ gateway, assets, guard }: AppDeps) {
  const quotes = new QuoteCache<OrderBody>();
  const overCap = (usd: number) =>
    new ApiError(400, "invalid_argument", `orders are capped at $${guard.maxOrderUsd} (this one is about $${usd.toFixed(2)})`, {
      code: "over_cap",
    });

  async function prepare(userId: string, { asset_id, side, amount }: OrderBody) {
    const asset = assets.byId(asset_id);
    if (!asset?.chain || assets.isCash(asset)) {
      throw new ApiError(400, "invalid_argument", `asset_id: ${asset_id} is not offered for trading`);
    }
    // A buy is sized in USDC, so it can be checked before anything is created upstream.
    if (side === "buy" && Number(amount) > guard.maxOrderUsd) throw overCap(Number(amount));

    const created = await gateway.createOrder(userId, {
      asset_id: asset.id,
      chain: asset.chain,
      side,
      qty: amount,
      qty_unit: side === "buy" ? "quote" : "base",
    });
    const issue = created.quote?.issues?.[0];
    if (issue) throw new ApiError(422, "failed_precondition", issue);
    if (side === "sell") {
      const proceeds = Number(created.quote?.qty_out);
      if (!Number.isFinite(proceeds)) throw new ApiError(422, "failed_precondition", "couldn't value this sale against the order cap");
      if (proceeds > guard.maxOrderUsd) throw overCap(proceeds);
    }
    if (!created.payloads?.length) throw nothingToSign();
    return { ...created, id: created.order_id, payloads: created.payloads };
  }

  return new Hono<AppEnv>()
    .post("/orders", requireCustomer, async (c) => {
      const customer = c.var.customer;
      const request = await parseJson(c, orderBody);
      const created = await prepare(gatewayUserId(customer), request);
      const preparedAt = quotes.put(created.id, customer.id, request, created.payloads);
      return c.json({
        order_id: created.id,
        status: created.status,
        quote: created.quote && {
          ...created.quote,
          base_asset: assets.symbolOf(created.quote.base_asset),
          quote_asset: assets.symbolOf(created.quote.quote_asset),
          fee_asset: assets.symbolOf(created.quote.fee_asset),
        },
        prepared_at: new Date(preparedAt).toISOString(),
      });
    })
    .post("/orders/:id/execute", requireCustomer, async (c) => {
      if (guard.dryRun) throw dryRunBlocked();
      const customer = c.var.customer;
      const userId = gatewayUserId(customer);
      const order = await quotes.signable(c.req.param("id"), customer.id, (request) => prepare(userId, request));
      if (!order) throw quoteExpired();

      const signatures = stampAll(order.payloads);
      const { status } = await gateway.executeOrder(userId, order.id, signatures);
      return c.json({ order_id: order.id, status });
    })
    .get("/orders/:id", requireCustomer, async (c) => {
      const order = await gateway.getOrder(gatewayUserId(c.var.customer), c.req.param("id"));
      // Conductor's single-order read omits the chain, so it never builds the explorer link its list reads carry.
      const chain = order.asset_id ? assets.byId(order.asset_id)?.chain : undefined;
      return c.json({ ...order, explorer_url: order.explorer_url ?? explorerTxUrl(chain, order.tx_hash) });
    });
}
