import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { isPriceMoved, useAssets, usePortfolio } from "../api.ts";
import { Page } from "../components/AppShell.tsx";
import {
  AssetTile,
  Banner,
  Button,
  Card,
  Label,
  Mono,
  DetailRow,
  PriceChange,
  SettlementNotice,
  Spinner,
  Stat,
  TextButton,
} from "../components/ui.tsx";
import { chainName, fractionOf, holdings, isPositiveDecimal, sanitizeDecimal, tokenAmount, toRatio, usd, type Holding } from "../format.ts";
import { useDebounced, useNow, usePreparedFlow } from "../hooks.ts";
import type { AssetRow, OrderDetail, PreparedOrder } from "../types.ts";

type Side = "buy" | "sell";

const ORDER_TERMINAL = ["complete", "failed", "canceled"] as const;
const BUY_CHIPS = ["10", "25", "50"];
const SELL_CHIPS = [25, 50, 75];

function TokenList({ tokens, selected, onSelect }: { tokens: AssetRow[]; selected?: string; onSelect: (assetId: string) => void }) {
  return (
    <Card className="flex max-h-[720px] flex-col gap-1.5 overflow-y-auto p-[18px]">
      <h2 className="m-0 mb-2 ml-1.5 text-[17px] font-bold">Tokens</h2>
      {tokens.map((token) => {
        const active = token.asset_id === selected;
        return (
          <button
            key={token.asset_id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(token.asset_id)}
            className={`flex cursor-pointer items-center gap-3 rounded-[14px] border p-3 text-left text-text ${
              active ? "border-accent bg-line" : "border-transparent bg-transparent hover:bg-line/60"
            }`}
          >
            <AssetTile symbol={token.symbol} icon={token.icon} />
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-bold">{token.name}</span>
              <span className="text-[13px] text-muted">
                {token.symbol} · {chainName(token.chain)}
              </span>
            </span>
            <span className="flex flex-col items-end gap-0.5">
              <Mono className="text-sm">{usd(token.price)}</Mono>
              <PriceChange ratio={toRatio(token.change_24h)} className="text-xs" />
            </span>
          </button>
        );
      })}
      <p className="mx-1.5 mt-2 mb-0 text-[13px] text-faint">Tokens on Solana and Base. Your cash is held as USDC on each network.</p>
    </Card>
  );
}

function quoteHint(fetching: boolean, failed: boolean): string {
  if (fetching) return "Getting a quote…";
  if (failed) return "No quote available.";
  return "Enter an amount to see a live quote.";
}

function QuoteAge({ preparedAt }: { preparedAt: string }) {
  const now = useNow(1000);
  return <>Updated {Math.max(0, Math.round((now - Date.parse(preparedAt)) / 1000))}s ago · refreshes every 10s</>;
}

function Ticket({
  token,
  side,
  onSide,
  position,
  cash,
}: {
  token: AssetRow;
  side: Side;
  onSide: (side: Side) => void;
  position?: Holding;
  cash?: Holding;
}) {
  const [amount, setAmount] = useState("");
  const settled = useDebounced(amount, 400);
  const { quote, settlement, flow, executeError, canConfirm, confirm, reset, retry } = usePreparedFlow<"order_id", PreparedOrder, OrderDetail>({
    path: "/api/orders",
    idKey: "order_id",
    body: { asset_id: token.asset_id, side, amount: settled },
    ready: isPositiveDecimal(settled),
    terminal: ORDER_TERMINAL,
    success: "complete",
    refresh: true,
  });
  const status = settlement.data?.status;

  function done() {
    reset();
    setAmount("");
  }

  const buy = side === "buy";
  const available = buy ? cash?.available : position?.available;
  const decimals = buy ? 2 : (position?.decimals ?? 6);
  const q = quote.data?.quote;
  const priceEach = q && Number(q.qty_out) > 0 ? (buy ? Number(settled) / Number(q.qty_out) : Number(q.qty_out) / Number(settled)) : null;

  return (
    <Card className="flex flex-col gap-[18px] p-6">
      <div className="grid grid-cols-2 gap-1.5 rounded-[14px] border border-edge bg-ink p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            disabled={flow !== null}
            onClick={() => onSide(s)}
            className={`h-[42px] cursor-pointer rounded-[10px] border-none text-[15px] font-bold capitalize ${
              side === s ? "bg-accent text-ink" : "bg-transparent text-muted hover:text-text"
            }`}
          >
            {s} {token.symbol}
          </button>
        ))}
      </div>

      <label className="flex flex-col items-center gap-1.5 pt-3.5 pb-1">
        <Label>{buy ? "You pay" : "You sell"}</Label>
        <span className="flex items-baseline gap-2 font-mono text-[56px]">
          {buy && <span className="text-muted">$</span>}
          <input
            value={amount}
            inputMode="decimal"
            placeholder="0"
            disabled={flow !== null}
            aria-label={buy ? "Amount in US dollars" : `Amount of ${token.symbol}`}
            onChange={(e) => setAmount(sanitizeDecimal(e.target.value))}
            className="w-[5.5ch] border-none bg-transparent text-center font-mono text-text outline-none placeholder:text-edge"
          />
          {!buy && <span className="text-2xl text-muted">{token.symbol}</span>}
        </span>
        <span className="text-sm text-muted">
          {available === undefined ? "—" : buy ? `${usd(available)} cash available` : `${tokenAmount(available, token.symbol)} available`}
        </span>
      </label>

      <div className="grid grid-cols-4 gap-2">
        {buy
          ? BUY_CHIPS.map((chip) => (
              <Chip key={chip} active={amount === chip} disabled={flow !== null} onClick={() => setAmount(chip)}>
                ${chip}
              </Chip>
            ))
          : SELL_CHIPS.map((pct) => {
              const value = available ? fractionOf(available, pct, decimals) : "";
              return (
                <Chip key={pct} active={!!value && amount === value} disabled={!available || flow !== null} onClick={() => setAmount(value)}>
                  {pct}%
                </Chip>
              );
            })}
        <Chip active={!!available && amount === available} disabled={!available || flow !== null} onClick={() => setAmount(available ?? "")}>
          Max
        </Chip>
      </div>

      <div className="rounded-[14px] border border-edge bg-ink px-4 py-0.5">
        <DetailRow
          label="You get (est.)"
          value={q ? (buy ? tokenAmount(q.qty_out, token.symbol) : `${usd(q.qty_out)} USDC`) : "—"}
        />
        <DetailRow label="Price" value={priceEach === null ? "—" : `${usd(priceEach)} / ${token.symbol}`} />
        <DetailRow label="Network fee" value="Covered by Tensho" />
        {q && Number(q.fee) > 0 && <DetailRow label="Fee" value={`${tokenAmount(q.fee)} ${q.fee_asset}`} />}
        <p className="m-0 py-2.5 text-xs text-faint">
          {quote.data ? <QuoteAge preparedAt={quote.data.prepared_at} /> : quoteHint(quote.isFetching, quote.isError)}
        </p>
      </div>

      {quote.error && !executeError && <Banner tone="error">{quote.error.message}</Banner>}
      {executeError && (
        <Banner tone="error" title={isPriceMoved(executeError) ? "Price moved and nothing was traded." : undefined}>
          {isPriceMoved(executeError) ? "Review the quote again." : executeError.message}{" "}
          <TextButton onClick={retry}>{isPriceMoved(executeError) ? "Review again" : "Try again"}</TextButton>
        </Banner>
      )}

      {flow ? (
        <SettlementNotice
          state={flow}
          success={
            buy
              ? `Bought ${tokenAmount(settlement.data?.executed_qty ?? "0", token.symbol)}.`
              : `Sold ${tokenAmount(settlement.data?.executed_qty ?? settled, token.symbol)}.`
          }
          failure={status === "canceled" ? "The order was canceled. Nothing moved." : settlement.data?.failure_reason}
          explorerUrl={settlement.data?.explorer_url}
          onDone={done}
        />
      ) : (
        <Button
          className="mt-auto h-[54px] rounded-2xl text-base"
          disabled={!canConfirm || amount !== settled}
          onClick={confirm}
        >
          Confirm {side}
        </Button>
      )}
    </Card>
  );
}

function Chip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-10 cursor-pointer rounded-xl border bg-ink text-sm text-text disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "border-accent font-bold" : "border-edge"
      }`}
    >
      {children}
    </button>
  );
}

export function Trade() {
  const [params, setParams] = useSearchParams();
  const assets = useAssets();
  const portfolio = usePortfolio();

  const tokens = assets.data?.filter((a) => !a.cash) ?? [];
  const side: Side = params.get("side") === "sell" ? "sell" : "buy";
  const token = tokens.find((t) => t.asset_id === params.get("asset")) ?? tokens[0];
  const rows = holdings(portfolio.data, assets.data);
  const position = rows.find((h) => h.symbol === token?.symbol && h.chain === token.chain);
  const cash = rows.find((h) => h.cash && h.chain === token?.chain);

  function select(next: { asset?: string; side?: Side }) {
    setParams({ asset: next.asset ?? token?.asset_id ?? "", side: next.side ?? side }, { replace: true });
  }

  return (
    <Page title="Trade" subtitle="Buy and sell tokens with your cash balance.">
      {assets.error && <Banner tone="error">{assets.error.message}</Banner>}
      {!token ? (
        <Spinner />
      ) : (
        <div className="grid flex-1 grid-cols-[1fr_1.25fr_0.9fr] items-start gap-5">
          <TokenList tokens={tokens} selected={token.symbol} onSelect={(asset) => select({ asset })} />
          <Ticket
            key={`${token.asset_id}:${side}`}
            token={token}
            side={side}
            onSide={(s) => select({ side: s })}
            position={position}
            cash={cash}
          />
          <Card className="flex flex-col gap-4 p-[22px]">
            <h2 className="m-0 text-[17px] font-bold">Your {token.symbol}</h2>
            <Stat
              label="Balance"
              value={tokenAmount(position?.total ?? "0", token.symbol)}
              detail={usd(position?.value ?? (position ? null : 0))}
            />
            <div className="flex flex-col gap-1">
              <Label>Cash available</Label>
              <Mono className="text-[22px]">{usd(cash?.available ?? 0)}</Mono>
            </div>
            <p className="m-0 mt-6 text-[13px] leading-relaxed text-faint">
              Prices move between quote and fill. If a trade can't land within your slippage, it's cancelled and nothing moves.
            </p>
          </Card>
        </div>
      )}
    </Page>
  );
}
