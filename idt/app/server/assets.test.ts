import { describe, expect, it } from "vitest";
import { assets, loadAssets } from "./assets.ts";
import { assetItem as asset } from "./testing.ts";
import type { AssetItem, Page } from "./tm/types.ts";

function page(...items: AssetItem[]): () => Promise<Page<AssetItem>> {
  return async () => ({ data: items, pagination: { next_cursor: null, limit: 100 } });
}

const LISTED = [
  asset("USDC", "solana"),
  asset("USDC", "base"),
  asset("USDC", "ethereum"),
  asset("SOL"),
  asset("PENGU"),
  asset("AERO", "base"),
  asset("AERO", "solana"),
];

describe("loadAssets", () => {
  it("resolves each configured token on its own chain", async () => {
    await loadAssets(page(...LISTED));

    expect(assets.tradeable().map((a) => a.id)).toEqual(["SOL-solana", "PENGU-solana", "AERO-base"]);
  });

  it("holds USDC as cash on every chain it trades, and only those", async () => {
    await loadAssets(page(...LISTED));

    const cash = assets.all().filter((a) => assets.isCash(a));

    expect(cash.map((a) => a.id)).toEqual(["USDC-solana", "USDC-base"]);
    expect(assets.isCash(assets.byId("SOL-solana")!)).toBe(false);
  });

  it("looks assets up by id and symbols up by address", async () => {
    await loadAssets(page(...LISTED));

    expect(assets.byId("AERO-base")?.chain).toBe("base");
    expect(assets.byId("USDC-ethereum")).toBeUndefined();
    expect(assets.symbolOf("PENGU-mint")).toBe("PENGU");
    expect(assets.symbolOf("unknown-mint")).toBe("unknown-mint");
  });

  it("fails naming a token that is not listed on its chain", async () => {
    const load = loadAssets(page(asset("USDC", "solana"), asset("USDC", "base"), asset("SOL"), asset("PENGU")));

    await expect(load).rejects.toThrow("Unknown token AERO on base");
  });
});
