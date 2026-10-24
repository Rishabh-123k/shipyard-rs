import { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { gatewayUserId, requireCustomer, type AppEnv } from "../session.ts";
import { TMError } from "../tm/errors.ts";

export function walletRoutes({ gateway, assets, prices }: AppDeps) {
  return new Hono<AppEnv>()
    .get("/portfolio", requireCustomer, async (c) => {
      const userId = gatewayUserId(c.var.customer);
      try {
        return c.json(await gateway.portfolio(userId));
      } catch (err) {
        // Conductor answers 503 when it cannot price the portfolio; quantities are still worth showing.
        if (!(err instanceof TMError) || err.status !== 503) throw err;
        const { data } = await gateway.balances(userId);
        return c.json({ priced: false, balances: data });
      }
    })
    .get("/assets", requireCustomer, (c) => {
      const rows = assets.all().map((asset) => ({
        asset_id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        chain: asset.chain,
        icon: asset.icon,
        ...prices.get(asset.symbol),
        cash: assets.isCash(asset),
      }));
      return c.json(rows);
    })
    .get("/transactions", requireCustomer, async (c) => {
      const page = await gateway.listTransactions(gatewayUserId(c.var.customer));
      // Conductor lists prepared-but-unsigned transfers, while it already leaves unexecuted orders out.
      const data = page.data.filter((tx) => tx.transfer?.status !== "awaiting_signature");
      return c.json({ ...page, data });
    });
}
