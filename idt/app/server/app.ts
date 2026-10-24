import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { AssetCatalog } from "./assets.ts";
import { ApiError, errorResponse } from "./http.ts";
import type { PriceBook } from "./prices.ts";
import { authRoutes } from "./routes/auth.ts";
import { idtRoutes } from "./routes/idt.ts";
import { orderRoutes } from "./routes/orders.ts";
import { transferRoutes } from "./routes/transfers.ts";
import { walletRoutes } from "./routes/wallet.ts";
import type * as gateway from "./tm/gateway.ts";

export interface TradeGuard {
  dryRun: boolean;
  maxOrderUsd: number;
}

export interface AppDeps {
  gateway: typeof gateway;
  assets: AssetCatalog;
  prices: PriceBook;
  guard: TradeGuard;
}

const DIST = "./dist";

export function createApp(deps: AppDeps) {
  const app = new Hono()
    .route("/api", authRoutes(deps))
    .route("/api", walletRoutes(deps))
    .route("/api", orderRoutes(deps))
    .route("/api", transferRoutes(deps))
    .route("/api", idtRoutes())
    .all("/api/*", () => {
      throw new ApiError(404, "not_found", "not found");
    });

  app.onError(errorResponse);

  if (existsSync(DIST)) {
    app.use("*", serveStatic({ root: DIST }));
    app.get("*", serveStatic({ path: `${DIST}/index.html` }));
  }

  return app;
}
