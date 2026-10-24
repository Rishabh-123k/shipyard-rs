import { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { requireCustomer, type AppEnv } from "../session.ts";

export function journalRoutes({ idt, guard }: AppDeps) {
  return new Hono<AppEnv>()
    .get("/journal", requireCustomer, async (c) => c.json(await idt.journal(c.var.customer.id)))
    .get("/trade-guard", requireCustomer, (c) =>
      c.json({ dry_run: guard.dryRun, max_order_usd: guard.maxOrderUsd, max_total_usd: guard.maxTotalUsd }),
    );
}
