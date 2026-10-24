import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { isAddressOn } from "../../shared/validation.ts";
import { ApiError, dryRunBlocked, nothingToSign, parseJson, positiveDecimal, quoteExpired } from "../http.ts";
import { QuoteCache } from "../pending.ts";
import { gatewayUserId, requireCustomer, type AppEnv } from "../session.ts";
import { stampAll } from "../tm/stamp.ts";

const transferBody = z.object({
  asset_id: z.string().min(1),
  qty: positiveDecimal,
  to: z.string().min(1),
});

type TransferBody = z.infer<typeof transferBody>;

export function transferRoutes({ gateway, assets, guard }: AppDeps) {
  const quotes = new QuoteCache<TransferBody>();

  async function prepare(userId: string, { asset_id, qty, to }: TransferBody) {
    const asset = assets.byId(asset_id);
    if (!asset) throw new ApiError(400, "invalid_argument", `asset_id: ${asset_id} cannot be sent from Tensho`);
    if (!isAddressOn(asset.chain, to)) {
      throw new ApiError(400, "invalid_argument", `to: must be a ${asset.chain} address`);
    }

    const created = await gateway.createTransfer(userId, { asset_id: asset.id, qty, to });
    if (!created.payloads?.length) throw nothingToSign();
    return { ...created, payloads: created.payloads };
  }

  return new Hono<AppEnv>()
    .post("/transfers", requireCustomer, async (c) => {
      const customer = c.var.customer;
      const request = await parseJson(c, transferBody);
      const created = await prepare(gatewayUserId(customer), request);
      const preparedAt = quotes.put(created.id, customer.id, request, created.payloads);
      return c.json({
        transfer_id: created.id,
        status: created.status,
        fee: created.fee,
        qty: created.qty,
        prepared_at: new Date(preparedAt).toISOString(),
      });
    })
    .post("/transfers/:id/execute", requireCustomer, async (c) => {
      if (guard.dryRun) throw dryRunBlocked();
      const customer = c.var.customer;
      const userId = gatewayUserId(customer);
      const transfer = await quotes.signable(c.req.param("id"), customer.id, (request) => prepare(userId, request));
      if (!transfer) throw quoteExpired();

      const signatures = stampAll(transfer.payloads);
      const { status } = await gateway.executeTransfer(userId, transfer.id, signatures);
      return c.json({ transfer_id: transfer.id, status });
    })
    .get("/transfers/:id", requireCustomer, async (c) => {
      return c.json(await gateway.getTransfer(gatewayUserId(c.var.customer), c.req.param("id")));
    });
}
