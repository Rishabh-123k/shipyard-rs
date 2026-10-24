import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { explorerTxUrl } from "../explorer.ts";
import { ApiError, nothingToSign, parseJson, positiveDecimal, quoteExpired } from "../http.ts";
import { QuoteCache } from "../pending.ts";
import { gatewayUserId, requireCustomer, type AppEnv } from "../session.ts";
import { stampAll } from "../tm/stamp.ts";

const orderBody = z.object({
  asset_id: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  amount: positiveDecimal,
});

const executeBody = z.object({
  confirm_token: z.string().min(1),
  evidence: z.object({
    version: z.string().min(1),
    snapshot_id: z.string().min(1),
    event_id: z.string().min(1).nullish(),
    cited_post_ids: z.array(z.string()).max(20).default([]),
    rationale: z.string().max(1000).optional(),
  }),
});

type OrderBody = z.infer<typeof orderBody>;

// Spec: a confirmation dies after 60s, or as soon as a newer snapshot changes the evidence it was shown with.
const CONFIRM_TTL_MS = 60_000;
const ORDER_TERMINAL = new Set(["complete", "failed", "canceled"]);

interface Confirmation {
  token: string;
  customerId: string;
  issuedAt: number;
  asset: string;
  version: string | null;
  side: "buy" | "sell";
  usd: number;
  quote: unknown;
}

const evidenceChanged = (message = "A newer snapshot landed after you reviewed this trade. Review the evidence again.") =>
  new ApiError(409, "failed_precondition", message, { code: "evidence_changed" });

export function orderRoutes({ gateway, assets, guard, idt }: AppDeps) {
  const quotes = new QuoteCache<OrderBody>();
  const confirmations = new Map<string, Confirmation>();
  const tradeByOrder = new Map<string, string>();
  let liveQueue: Promise<unknown> = Promise.resolve();

  // Live executes run one at a time so two orders can't both pass the cumulative cap check.
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = liveQueue.then(fn, fn);
    liveQueue = run.catch(() => undefined);
    return run;
  }

  const overCap = (usd: number) =>
    new ApiError(400, "invalid_argument", `orders are capped at $${guard.maxOrderUsd} (this one is about $${usd.toFixed(2)})`, {
      code: "over_cap",
    });

  async function prepare(userId: string, { asset_id, side, amount }: OrderBody) {
    const asset = assets.byId(asset_id);
    if (!asset?.chain || assets.isCash(asset)) {
      throw new ApiError(400, "invalid_argument", `asset_id: ${asset_id} is not offered for trading`);
    }
    if (!idt.assetFor(asset.symbol)) {
      throw new ApiError(400, "invalid_argument", `${asset.symbol} has no implied distribution to trade against; cryptoshi trades BTC and ETH`);
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
    const usd = side === "buy" ? Number(amount) : Number(created.quote?.qty_out);
    if (side === "sell") {
      if (!Number.isFinite(usd)) throw new ApiError(422, "failed_precondition", "couldn't value this sale against the order cap");
      if (usd > guard.maxOrderUsd) throw overCap(usd);
    }
    if (!created.payloads?.length) throw nothingToSign();
    return { ...created, id: created.order_id, payloads: created.payloads, usd, evidenceAsset: idt.assetFor(asset.symbol)! };
  }

  async function simulate({ asset_id, side, amount }: OrderBody) {
    const asset = assets.byId(asset_id)!;
    const evidenceAsset = idt.assetFor(asset.symbol)!;
    const usd = side === "buy" ? Number(amount) : Number(amount) * (await idt.cefiQuote(evidenceAsset, "sell", 10)).price;
    if (usd > guard.maxOrderUsd) throw overCap(usd);
    const q = await idt.cefiQuote(evidenceAsset, side, usd);
    return {
      id: `dryrun-${randomUUID()}`,
      status: "simulated",
      usd,
      evidenceAsset,
      source: q.source,
      quote: {
        base_asset: asset.symbol,
        quote_asset: "USDC",
        qty: amount,
        qty_out: side === "buy" ? (usd / q.price).toFixed(8) : usd.toFixed(2),
        fee: q.fee ?? "0",
        fee_asset: "USDC",
      },
    };
  }

  function issueConfirmation(orderId: string, c: Omit<Confirmation, "token" | "issuedAt">): Confirmation {
    const now = Date.now();
    for (const [key, entry] of confirmations) {
      if (now - entry.issuedAt > 5 * CONFIRM_TTL_MS) confirmations.delete(key);
    }
    const confirmation = { ...c, token: randomBytes(16).toString("hex"), issuedAt: now };
    confirmations.set(orderId, confirmation);
    return confirmation;
  }

  async function settle(tradeId: string, update: { status: string; order_id?: string; error?: string }) {
    await idt.updateTrade(tradeId, update).catch((err: unknown) => console.error(`journal update failed for ${tradeId}`, err));
  }

  return new Hono<AppEnv>()
    .post("/orders", requireCustomer, async (c) => {
      const customer = c.var.customer;
      const request = await parseJson(c, orderBody);
      let created: { id: string; status?: string; usd: number; evidenceAsset: string };
      let quote: unknown;
      let simulated: { reason: string; source: string } | null = null;
      let preparedAt = Date.now();
      try {
        const real = await prepare(gatewayUserId(customer), request);
        preparedAt = quotes.put(real.id, customer.id, request, real.payloads);
        created = real;
        quote = real.quote && {
          ...real.quote,
          base_asset: assets.symbolOf(real.quote.base_asset),
          quote_asset: assets.symbolOf(real.quote.quote_asset),
          fee_asset: assets.symbolOf(real.quote.fee_asset),
        };
      } catch (err) {
        // Dry run only: an order the wallet can't fill (e.g. unfunded) is priced from a CeFi quote instead,
        // labeled as simulated, and never cached for signing.
        if (!(guard.dryRun && err instanceof ApiError && err.status === 422)) throw err;
        const sim = await simulate(request);
        created = sim;
        quote = sim.quote;
        simulated = { reason: err.message, source: sim.source };
      }
      const version = await idt.evidenceVersion(created.evidenceAsset).catch(() => null);
      const confirm = issueConfirmation(created.id, {
        customerId: customer.id,
        asset: created.evidenceAsset,
        version,
        side: request.side,
        usd: created.usd,
        quote,
      });
      return c.json({
        order_id: created.id,
        status: created.status,
        quote,
        simulated,
        prepared_at: new Date(preparedAt).toISOString(),
        confirm: {
          token: confirm.token,
          expires_at: new Date(confirm.issuedAt + CONFIRM_TTL_MS).toISOString(),
          evidence_asset: confirm.asset,
          evidence_version: version,
          usd_amount: created.usd,
        },
      });
    })
    .post("/orders/:id/execute", requireCustomer, async (c) => {
      const customer = c.var.customer;
      const orderId = c.req.param("id");
      const confirm = confirmations.get(orderId);
      if (!confirm || confirm.customerId !== customer.id) throw quoteExpired();

      const { confirm_token, evidence } = await parseJson(c, executeBody);
      if (confirm_token !== confirm.token) {
        throw new ApiError(403, "permission_denied", "confirmation token doesn't match this quote", { code: "confirm_invalid" });
      }
      if (Date.now() - confirm.issuedAt > CONFIRM_TTL_MS) {
        confirmations.delete(orderId);
        throw new ApiError(409, "failed_precondition", "confirmation expired after 60 seconds, review again", { code: "quote_stale" });
      }
      if (!confirm.version) throw evidenceChanged("There's no stored snapshot to journal this trade against yet.");
      if (evidence.version !== confirm.version || (await idt.evidenceVersion(confirm.asset)) !== confirm.version) {
        confirmations.delete(orderId);
        throw evidenceChanged();
      }
      confirmations.delete(orderId);

      const tradeId = randomUUID().replaceAll("-", "");
      const record = {
        trade_id: tradeId,
        customer_id: customer.id,
        asset: confirm.asset,
        side: confirm.side,
        usd_amount: confirm.usd,
        quote: confirm.quote,
        order_id: orderId,
        version: confirm.version,
        snapshot_id: evidence.snapshot_id,
        event_id: evidence.event_id ?? null,
        cited_post_ids: evidence.cited_post_ids,
        rationale: evidence.rationale,
      };

      if (guard.dryRun) {
        await idt.recordTrade({ ...record, status: "dry_run", dry_run: true });
        return c.json({ order_id: orderId, status: "dry_run", trade_id: tradeId });
      }

      return serialized(async () => {
        const committed = await idt.liveTotalUsd();
        if (committed + confirm.usd > guard.maxTotalUsd) {
          throw new ApiError(
            400,
            "invalid_argument",
            `this would take live trading to $${(committed + confirm.usd).toFixed(2)}, over the $${guard.maxTotalUsd} total cap`,
            { code: "over_total_cap" },
          );
        }
        // Journal first: if the journal is unreachable, nothing gets signed.
        await idt.recordTrade({ ...record, status: "executing", dry_run: false });

        const userId = gatewayUserId(customer);
        try {
          const order = await quotes.signable(orderId, customer.id, (request) => prepare(userId, request));
          if (!order) {
            await settle(tradeId, { status: "rejected", error: "quote expired before signing" });
            throw quoteExpired();
          }
          const { status } = await gateway.executeOrder(userId, order.id, stampAll(order.payloads));
          tradeByOrder.set(order.id, tradeId);
          await settle(tradeId, { status: status ?? "pending", order_id: order.id });
          return c.json({ order_id: order.id, status, trade_id: tradeId });
        } catch (err) {
          if (!(err instanceof ApiError && err.code === "quote_stale")) {
            await settle(tradeId, { status: "failed", error: err instanceof Error ? err.message : String(err) });
          }
          throw err;
        }
      });
    })
    .get("/orders/:id", requireCustomer, async (c) => {
      const orderId = c.req.param("id");
      const order = await gateway.getOrder(gatewayUserId(c.var.customer), orderId);
      const tradeId = tradeByOrder.get(orderId);
      if (tradeId && order.status && ORDER_TERMINAL.has(order.status)) {
        tradeByOrder.delete(orderId);
        await settle(tradeId, { status: order.status, error: order.failure_reason ?? undefined });
      }
      // Conductor's single-order read omits the chain, so it never builds the explorer link its list reads carry.
      const chain = order.asset_id ? assets.byId(order.asset_id)?.chain : undefined;
      return c.json({ ...order, explorer_url: order.explorer_url ?? explorerTxUrl(chain, order.tx_hash) });
    });
}
