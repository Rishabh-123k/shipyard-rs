import { useState } from "react";
import { Link } from "react-router";
import { isAddressOn } from "../../../shared/validation.ts";
import { useAssets, usePortfolio } from "../api.ts";
import { Page } from "../components/AppShell.tsx";
import { AssetTile, Banner, Button, Card, DetailRow, Label, Mono, SettlementNotice, TextButton } from "../components/ui.tsx";
import { chainName, holdings, isPositiveDecimal, sanitizeDecimal, shortAddress, tokenAmount } from "../format.ts";
import { useDebounced, usePreparedFlow } from "../hooks.ts";
import type { PreparedTransfer, TransferDetail } from "../types.ts";

const TRANSFER_TERMINAL = ["completed", "failed"] as const;

const FIELD = "flex flex-col gap-2 text-[13px] text-muted";

export function Send() {
  const assets = useAssets();
  const portfolio = usePortfolio();

  const [chosen, setChosen] = useState<string>();
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const recipient = to.trim();
  const settledTo = useDebounced(recipient, 400);
  const settledQty = useDebounced(qty, 400);

  const rows = holdings(portfolio.data, assets.data);
  const holdingOf = (a: { symbol: string; chain: string | null }) => rows.find((h) => h.symbol === a.symbol && h.chain === a.chain);
  const options = (assets.data ?? [])
    .filter((a) => Number(holdingOf(a)?.available ?? 0) > 0)
    .sort((a, b) => Number(b.cash) - Number(a.cash));
  const asset = options.find((a) => a.asset_id === chosen) ?? options[0];
  const symbol = asset?.symbol ?? "";
  const network = chainName(asset?.chain ?? null);
  const holding = asset && holdingOf(asset);
  const validAddress = (address: string) => asset !== undefined && isAddressOn(asset.chain, address);
  const addressState = recipient === "" ? "empty" : validAddress(recipient) ? "valid" : "invalid";

  const { quote, settlement, flow, executeError, canConfirm, confirm, reset, retry } = usePreparedFlow<"transfer_id", PreparedTransfer, TransferDetail>({
    path: "/api/transfers",
    idKey: "transfer_id",
    body: { asset_id: asset?.asset_id ?? "", qty: settledQty, to: settledTo },
    ready: validAddress(settledTo) && isPositiveDecimal(settledQty),
    terminal: TRANSFER_TERMINAL,
    success: "completed",
    refresh: false,
  });
  const locked = flow !== null;

  function done() {
    reset();
    setQty("");
  }

  return (
    <Page title="Send" subtitle="Move tokens to any external wallet.">
      <div className="grid flex-1 grid-cols-[1.3fr_1fr] items-start gap-5">
        <Card className="flex flex-col gap-5 p-7">
          <fieldset className={`${FIELD} m-0 border-none p-0`}>
            <legend className="mb-2 p-0">Asset</legend>
            <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto pr-1">
              {options.map((option) => {
                const owned = holdingOf(option);
                const active = option.asset_id === asset?.asset_id;
                return (
                  <button
                    key={option.asset_id}
                    type="button"
                    aria-pressed={active}
                    disabled={locked}
                    onClick={() => {
                      setChosen(option.asset_id);
                      setQty("");
                    }}
                    className={`flex cursor-pointer items-center gap-3 rounded-[14px] border bg-ink px-3.5 py-2.5 text-left text-text ${
                      active ? "border-accent" : "border-edge"
                    }`}
                  >
                    <AssetTile symbol={option.symbol} icon={option.icon} size={36} />
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-[15px] font-bold">{option.cash ? `Cash (${option.symbol})` : option.name}</span>
                      <Mono className="text-[13px] text-muted">
                        {tokenAmount(owned?.available ?? "0")} available · {chainName(option.chain)}
                      </Mono>
                    </span>
                  </button>
                );
              })}
              {portfolio.isSuccess && options.length === 0 && (
                <p className="m-0 text-sm text-muted">
                  Nothing to send yet. <Link to="/add-funds">Add funds</Link> first.
                </p>
              )}
            </div>
          </fieldset>

          <label className={FIELD}>
            Recipient address
            <input
              value={to}
              disabled={locked}
              spellCheck={false}
              autoComplete="off"
              placeholder={`${network} address`}
              onChange={(e) => setTo(e.target.value)}
              className="h-[50px] rounded-[14px] border border-edge bg-ink px-3.5 font-mono text-sm text-text outline-none focus:border-muted"
            />
            {addressState !== "empty" && (
              <span className={`flex items-center gap-1.5 text-[13px] ${addressState === "valid" ? "text-up" : "text-down"}`}>
                <span className={`size-2 rounded-full ${addressState === "valid" ? "bg-up" : "bg-down"}`} />
                {addressState === "valid" ? `Valid ${network} address` : `Not a ${network} address`}
              </span>
            )}
          </label>

          <label className={FIELD}>
            Amount
            <span className="flex h-[60px] items-center gap-2.5 rounded-[14px] border border-edge bg-ink pr-2 pl-4">
              <input
                value={qty}
                disabled={locked}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => setQty(sanitizeDecimal(e.target.value))}
                className="min-w-0 flex-1 border-none bg-transparent font-mono text-[26px] text-text outline-none placeholder:text-edge"
              />
              <Mono className="text-[15px] text-muted">{symbol}</Mono>
              <Button
                variant="secondary"
                className="h-10 rounded-[10px] px-3.5 text-sm"
                disabled={!holding || locked}
                onClick={() => holding && setQty(holding.available)}
              >
                Max
              </Button>
            </span>
          </label>

          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-ink px-3.5 py-3 text-sm text-muted">
            <span className="font-bold text-text">Network</span>
            {network} · the only network this asset can be sent on from Tensho
          </div>
        </Card>

        <Card className="flex flex-col gap-[18px] p-7">
          <h2 className="m-0 text-[17px] font-bold">Review</h2>
          <div className="flex flex-col gap-1">
            <Label>You send</Label>
            <Mono className="text-[34px]">{isPositiveDecimal(qty) ? tokenAmount(qty, symbol) : `0 ${symbol}`}</Mono>
          </div>
          <div className="rounded-[14px] border border-edge bg-ink px-4 py-0.5">
            <DetailRow label="To" value={addressState === "valid" ? shortAddress(recipient) : "—"} />
            <DetailRow label="Network fee" value="Covered by Tensho" />
            <DetailRow label="Recipient gets" value={quote.data ? tokenAmount(quote.data.qty, symbol) : "—"} last />
          </div>
          {quote.isFetching && !quote.data && <span className="text-xs text-faint">Preparing the transfer…</span>}
          {quote.error && !executeError && <Banner tone="error">{quote.error.message}</Banner>}
          {executeError && (
            <Banner tone="error">
              {executeError.message} <TextButton onClick={retry}>Try again</TextButton>
            </Banner>
          )}
          <div className="rounded-[14px] border border-warn-edge bg-warn-bg px-4 py-3.5 text-sm leading-snug text-warn-text">
            Double-check the address. Crypto sent to the wrong address can't be reversed.
          </div>
          {flow ? (
            <SettlementNotice
              state={flow}
              success={`Sent ${tokenAmount(settlement.data?.qty ?? settledQty, symbol)} to ${shortAddress(settledTo)}.`}
              explorerUrl={settlement.data?.explorer_url}
              onDone={done}
            />
          ) : (
            <Button
              className="h-[54px]"
              disabled={!canConfirm || qty !== settledQty || recipient !== settledTo}
              onClick={confirm}
            >
              {isPositiveDecimal(qty) ? `Send ${tokenAmount(qty, symbol)}` : "Send"}
            </Button>
          )}
        </Card>
      </div>
    </Page>
  );
}
