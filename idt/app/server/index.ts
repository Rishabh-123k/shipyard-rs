import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { assets, loadAssets } from "./assets.ts";
import { env } from "./env.ts";
import { idt } from "./idt.ts";
import { printResetLink } from "./password-reset.ts";
import { prices, startPricePoller } from "./prices.ts";
import { TM_API_URL } from "./tm/client.ts";
import * as gateway from "./tm/gateway.ts";
import { walletSigner } from "./tm/stamp.ts";
import { orgKeyFile } from "./tm/token.ts";

await loadAssets();
startPricePoller([...new Set(assets.all().map((a) => a.symbol))]);

const app = createApp({
  gateway,
  assets,
  prices,
  idt,
  notifyPasswordReset: printResetLink,
  guard: { dryRun: env.DRY_RUN, maxOrderUsd: env.MAX_ORDER_USD, maxTotalUsd: env.MAX_TOTAL_USD },
});
if (env.DRY_RUN) console.log("DRY_RUN is on: quotes work, but orders and sends are never signed or executed");

serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  console.log(`listening on :${info.port} (True Markets at ${TM_API_URL}, org key file ${orgKeyFile})`);
});

if (walletSigner.created) {
  console.warn(
    `created the wallet signer key at ${walletSigner.file}: it signs for every customer's wallet, so back it up before funding any; deleting it locks those wallets for good`,
  );
}
