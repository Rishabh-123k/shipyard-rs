import { env } from "./env.ts";
import { listAssets } from "./tm/gateway.ts";
import type { AssetItem } from "./tm/types.ts";

const CASH_SYMBOL = "USDC";

interface Catalog {
  tradeable: AssetItem[];
  cash: Map<string, AssetItem>;
}

let catalog: Catalog = { tradeable: [], cash: new Map() };

function parseToken(entry: string): { symbol: string; chain: string } {
  const [symbol = "", chain = "solana"] = entry.split("@");
  return { symbol: symbol.toUpperCase(), chain: chain.toLowerCase() };
}

export async function loadAssets(fetchAssets = listAssets): Promise<void> {
  const { data } = await fetchAssets();
  const find = (symbol: string, chain: string) => {
    const item = data.find((a) => a.symbol.toUpperCase() === symbol && a.chain === chain);
    if (!item) throw new Error(`Unknown token ${symbol} on ${chain}`);
    return item;
  };

  const tradeable = env.TM_TOKENS.map(parseToken).map(({ symbol, chain }) => find(symbol, chain));
  const chains = new Set(tradeable.map((a) => a.chain ?? "solana"));
  const cash = new Map([...chains].map((chain) => [chain, find(CASH_SYMBOL, chain)]));
  catalog = { tradeable, cash };
}

export interface AssetCatalog {
  byId(id: string): AssetItem | undefined;
  symbolOf(address: string): string;
  tradeable(): AssetItem[];
  isCash(asset: AssetItem): boolean;
  all(): AssetItem[];
}

export const assets: AssetCatalog = {
  byId(id) {
    return this.all().find((a) => a.id === id);
  },
  // Quotes name assets by mint or contract address.
  symbolOf(address) {
    return this.all().find((a) => a.address === address)?.symbol ?? address;
  },
  tradeable() {
    return catalog.tradeable;
  },
  isCash(asset) {
    return [...catalog.cash.values()].includes(asset);
  },
  all() {
    return [...catalog.tradeable, ...catalog.cash.values()];
  },
};
