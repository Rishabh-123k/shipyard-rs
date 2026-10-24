import { verify } from "node:crypto";
import { signerPublicKey } from "./tm/stamp.ts";
import type { AssetItem } from "./tm/types.ts";

export function assetItem(symbol: string, chain = "solana"): AssetItem {
  return {
    id: `${symbol}-${chain}`,
    chain,
    address: `${symbol}-mint`,
    symbol,
    name: symbol,
    decimals: 6,
    icon: null,
    tradeable: true,
    stable: symbol === "USDC",
    venue: "defi",
  };
}

export function decodeStamp(value: string): Record<string, string> {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, string>;
}

export function verifiesStamp(stamp: string, payload: string): boolean {
  const der = Buffer.from(decodeStamp(stamp).signature ?? "", "hex");
  return verify("sha256", Buffer.from(payload), signerPublicKey, der);
}
