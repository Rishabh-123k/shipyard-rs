import { describe, expect, it } from "vitest";
import { describeTransaction } from "./format.ts";
import type { AssetRow, TransactionDetail } from "./types.ts";

const USDC = { symbol: "USDC", chain: "solana", cash: true } as AssetRow;
const PENGU = { symbol: "PENGU", chain: "solana", cash: false, price: "0.01" } as AssetRow;

function transfer(symbol: string, qty: string, unit: "base" | "quote" = "base", sent = qty): TransactionDetail {
  return {
    id: "t",
    type: "transfer",
    asset_flow: "out",
    status: "completed",
    qty,
    asset_symbol: symbol,
    transfer: { asset_symbol: symbol, chain: "solana", to: "7FW5ST96Ww1joBgcL2ex3Lx7cYwVMUnV61vGhLFjGL8A", qty_unit: unit, sent },
  } as TransactionDetail;
}

describe("describeTransaction", () => {
  it("values an order at its fill price", () => {
    const order = {
      type: "order",
      asset_flow: "in",
      qty: "119.17",
      asset_symbol: "PENGU",
      order: { side: "buy", executed_qty: "119.17", executed_vwap: "0.01007" },
    } as TransactionDetail;

    expect(describeTransaction(order, [PENGU])).toMatchObject({ amount: "+119.17 PENGU", value: "$1.20" });
  });

  it("values a cash send at its amount", () => {
    expect(describeTransaction(transfer("USDC", "1.2"), [USDC])).toMatchObject({ amount: "−1.2 USDC", value: "$1.20" });
  });

  it("shows no value for a token send, since no price at the time exists", () => {
    expect(describeTransaction(transfer("PENGU", "119.17"), [PENGU]).value).toBeNull();
  });

  it("reads a quote-unit send as dollars, with the tokens actually sent as the amount", () => {
    const view = describeTransaction(transfer("PENGU", "5", "quote", "498.5"), [PENGU]);

    expect(view).toMatchObject({ amount: "−498.5 PENGU", value: "$5.00" });
  });

  it("shows the customer-facing part of a failure and no value for a send that never moved", () => {
    const failed = {
      ...transfer("USDC", "0.187015"),
      status: "failed",
      failure_reason:
        "create defi transfer: prepare: deficore: failed to prepare transfer: invalid_argument/amount_below_minimum: transfer amount is below minimum transfer size",
    } as TransactionDetail;

    expect(describeTransaction(failed, [USDC])).toMatchObject({
      detail: "Transfer amount is below minimum transfer size",
      value: null,
    });
  });
});
