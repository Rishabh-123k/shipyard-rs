import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { ApiError, isPriceMoved, useAssets, usePortfolio } from "../api.ts";
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
import {
  EVIDENCE_ASSET,
  etDate,
  etDateLabel,
  etStamp,
  etTime,
  pct,
  price,
  useEvidence,
  useTradeGuard,
  venueMeta,
  type Evidence,
  type IdtAsset,
} from "../idt.ts";

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

interface Selection {
  ladderKey: string | null;
  postIds: string[];
  rationale: string;
  reviewed: boolean;
}

const EMPTY_SELECTION: Selection = { ladderKey: null, postIds: [], rationale: "", reviewed: false };

function ladderKey(l: { venue: string; resolution_at: string }): string {
  return `${l.venue}|${l.resolution_at}`;
}

function ConfirmCountdown({ expiresAt, version }: { expiresAt: string; version: string | null }) {
  const now = useNow(1000);
  const left = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return (
    <>
      Confirmation valid {left}s · bound to snapshot run <span className="font-mono">{version?.slice(0, 8) ?? "none"}</span>
    </>
  );
}

function EvidencePanel({
  asset,
  evidence,
  selection,
  onChange,
  loading,
}: {
  asset: IdtAsset;
  evidence?: Evidence;
  selection: Selection;
  onChange: (next: Selection) => void;
  loading: boolean;
}) {
  const ev = evidence?.event;
  const age = evidence?.age_seconds;
  const stale = age !== null && age !== undefined && age > (evidence?.fresh_for_seconds ?? 360);
  const set = (patch: Partial<Selection>) => onChange({ ...selection, ...patch });

  return (
    <Card className="flex flex-col gap-5 p-[22px]">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[17px] font-bold">Evidence for this {asset} trade</h2>
        <span className="text-xs text-faint">
          {evidence?.taken_at ? (
            <>
              Snapshot {etStamp(evidence.taken_at)} · run <span className="font-mono">{evidence.version?.slice(0, 8)}</span>
              {stale && <span className="text-amber"> · stale</span>}
            </>
          ) : (
            "No stored snapshot yet"
          )}
          {evidence?.refreshing && " · taking a fresh snapshot…"}
        </span>
      </div>

      {loading && !evidence && <Spinner label="Loading evidence from Snowflake" />}

      {evidence && (
        <div className="flex flex-col gap-2">
          <Label>1 · The ladder your trade is about</Label>
          <div role="radiogroup" aria-label="Thesis ladder" className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto">
            {evidence.ladders.map((l) => {
              const key = ladderKey(l);
              const active = key === selection.ladderKey;
              const v = venueMeta(l.venue);
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set({ ladderKey: key })}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-[13px] ${
                    active ? "border-muted bg-line text-text" : "border-edge bg-transparent text-muted hover:text-text"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: v.color }} />
                    {v.label} · {etDateLabel(etDate(l.resolution_at))} {etTime(l.resolution_at)}
                  </span>
                  <span className="font-mono text-xs">
                    P(&gt;{price(l.p_above_spot?.level, asset)}) {pct(l.p_above_spot?.prob)} · med {price(l.median, asset)}
                  </span>
                </button>
              );
            })}
            {evidence.ladders.length === 0 && <span className="text-sm text-muted">No ladders in the latest snapshot.</span>}
          </div>
        </div>
      )}

      {evidence && (
        <div className="flex flex-col gap-2">
          <Label>2 · Posts behind the latest shift (cite the ones you relied on)</Label>
          {ev ? (
            <>
              <div className="rounded-xl border border-line px-3 py-2.5 text-[13px]">
                <span className="text-text">
                  {venueMeta(ev.venue).label} · {etDateLabel(etDate(ev.resolution_at))} ladder
                </span>
                <span className="block text-muted">
                  {etStamp(ev.window_start)} → {etStamp(ev.window_end)} · P(&gt;{price(ev.level, asset)}) {pct(ev.p_before)} → {pct(ev.p_after)}
                </span>
                {ev.source === "backfill" && <span className="block text-xs text-amber">reconstructed from price history</span>}
              </div>
              {ev.posts.map((p) => {
                const checked = selection.postIds.includes(p.post_id);
                return (
                  <label key={p.post_id} className="flex cursor-pointer gap-3 rounded-xl border border-line px-3 py-2.5 text-[13px]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        set({ postIds: checked ? selection.postIds.filter((x) => x !== p.post_id) : [...selection.postIds, p.post_id] })
                      }
                      className="mt-0.5 accent-[#45e3ff]"
                    />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex items-center gap-2 text-text">
                        @{p.author ?? "unknown"}
                        <span className="text-xs text-faint">{etStamp(p.posted_at)}</span>
                        <a href={p.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center text-xs">
                          X <ExternalLink aria-hidden className="ml-0.5 size-3" />
                        </a>
                      </span>
                      <span className="line-clamp-3 text-muted">“{p.text}”</span>
                    </span>
                  </label>
                );
              })}
            </>
          ) : (
            <span className="text-sm text-muted">No shift in the last 24 hours, so there are no posts to cite.</span>
          )}
        </div>
      )}

      {evidence && (
        <div className="flex flex-col gap-2">
          <Label>3 · Your rationale (optional, saved to the journal)</Label>
          <textarea
            value={selection.rationale}
            maxLength={1000}
            rows={3}
            onChange={(e) => set({ rationale: e.target.value })}
            placeholder="e.g. Markets price 51% above spot for Oct 30 after the liquidation flush; I think that's too low."
            className="resize-none rounded-xl border border-edge bg-ink px-3 py-2.5 text-sm text-text outline-none focus:border-muted"
          />
          <label className="flex cursor-pointer items-start gap-3 text-[13px] text-text">
            <input
              type="checkbox"
              checked={selection.reviewed}
              onChange={(e) => set({ reviewed: e.target.checked })}
              className="mt-0.5 accent-[#ff4fa3]"
            />
            I reviewed this evidence and I'm making this decision myself.
          </label>
          <span className="text-xs text-faint">IDT never suggests or places trades on its own. Only your confirm click executes.</span>
        </div>
      )}
    </Card>
  );
}

function Ticket({
  token,
  side,
  onSide,
  position,
  cash,
  evidence,
  selection,
  dryRun,
}: {
  token: AssetRow;
  side: Side;
  onSide: (side: Side) => void;
  position?: Holding;
  cash?: Holding;
  evidence?: Evidence;
  selection: Selection;
  dryRun: boolean;
}) {
  const [amount, setAmount] = useState("");
  const settled = useDebounced(amount, 400);
  const snapshot = evidence?.ladders.find((l) => ladderKey(l) === selection.ladderKey);
  const { quote, settlement, flow, executeError, canConfirm, confirm, reset, retry } = usePreparedFlow<"order_id", PreparedOrder, OrderDetail>({
    path: "/api/orders",
    idKey: "order_id",
    body: { asset_id: token.asset_id, side, amount: settled },
    ready: isPositiveDecimal(settled),
    terminal: ORDER_TERMINAL,
    success: "complete",
    refresh: true,
    executeBody: (prepared) => ({
      confirm_token: prepared.confirm.token,
      evidence: {
        version: prepared.confirm.evidence_version,
        snapshot_id: snapshot?.snapshot_id,
        event_id: evidence?.event?.event_id ?? null,
        cited_post_ids: selection.postIds.filter((id) => evidence?.event?.posts.some((p) => p.post_id === id)),
        rationale: selection.rationale.trim() || undefined,
      },
    }),
  });
  const confirmInfo = quote.data?.confirm;
  const evidenceMatches = !!confirmInfo?.evidence_version && confirmInfo.evidence_version === evidence?.version;
  const blocker = !snapshot
    ? "Pick the ladder your trade is about."
    : !selection.reviewed
      ? "Tick the review box in the evidence panel."
      : quote.data && !evidenceMatches
        ? "Evidence just refreshed. Waiting for a quote bound to it…"
        : null;
  const evidenceChanged = executeError instanceof ApiError && executeError.code === "evidence_changed";
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
          {confirmInfo && (
            <span className="block">
              <ConfirmCountdown expiresAt={confirmInfo.expires_at} version={confirmInfo.evidence_version} />
            </span>
          )}
        </p>
      </div>

      {quote.data?.simulated && (
        <Banner title="Simulated quote (dry run)">
          True Markets can't fill this order from your wallet ({quote.data.simulated.reason}), so it's priced from{" "}
          {quote.data.simulated.source}. Nothing can be signed from it.
        </Banner>
      )}
      {quote.error && !executeError && <Banner tone="error">{quote.error.message}</Banner>}
      {executeError && (
        <Banner
          tone="error"
          title={
            evidenceChanged
              ? "New evidence landed. Nothing was traded."
              : isPriceMoved(executeError)
                ? "Price moved and nothing was traded."
                : undefined
          }
        >
          {evidenceChanged ? executeError.message : isPriceMoved(executeError) ? "Review the quote again." : executeError.message}{" "}
          <TextButton onClick={retry}>{isPriceMoved(executeError) || evidenceChanged ? "Review again" : "Try again"}</TextButton>
        </Banner>
      )}
      {!flow && blocker && <span className="text-center text-xs text-amber">{blocker}</span>}

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
          disabled={!canConfirm || amount !== settled || blocker !== null}
          onClick={confirm}
        >
          Confirm {side}
          {dryRun ? " (dry run)" : ""}
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

  const evidenceAsset = token ? EVIDENCE_ASSET[token.symbol.toUpperCase()] : undefined;
  const evidence = useEvidence(evidenceAsset);
  const guard = useTradeGuard();
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const ev = evidence.data;

  useEffect(() => setSelection(EMPTY_SELECTION), [evidenceAsset]);

  // Default thesis ladder: the nearest one that resolves more than two hours out.
  const defaultKey = useMemo(() => {
    const later = ev?.ladders.filter((l) => Date.parse(l.resolution_at) - Date.now() > 2 * 3_600_000) ?? [];
    return (later[0] ?? ev?.ladders[0]) ? ladderKey((later[0] ?? ev!.ladders[0])!) : null;
  }, [ev]);
  const eventId = ev?.event?.event_id;
  useEffect(() => {
    setSelection((s) => ({ ...s, postIds: ev?.event?.posts.filter((p) => p.in_window).map((p) => p.post_id) ?? [] }));
    // Re-default cited posts only when the event itself changes.
  }, [eventId]);
  const effective: Selection = {
    ...selection,
    ladderKey: selection.ladderKey && ev?.ladders.some((l) => ladderKey(l) === selection.ladderKey) ? selection.ladderKey : defaultKey,
  };

  return (
    <Page title="Trade" subtitle="Every order sits next to the evidence behind it, and lands in your journal with that evidence.">
      {guard.data && (
        <Banner title={guard.data.dry_run ? "Dry run: orders are journaled but never signed or sent" : "Live trading on mainnet"}>
          Orders are capped at {usd(guard.data.max_order_usd)} each and {usd(guard.data.max_total_usd)} in total across live trades. A
          confirmation expires after 60 seconds or as soon as a newer snapshot lands.
        </Banner>
      )}
      {assets.error && <Banner tone="error">{assets.error.message}</Banner>}
      {evidence.error && <Banner tone="error" title="Evidence unavailable">{evidence.error.message}</Banner>}
      {!token ? (
        <Spinner />
      ) : (
        <div className="grid flex-1 grid-cols-[0.8fr_1.05fr_1.25fr] items-start gap-5">
          <div className="flex flex-col gap-4">
            <TokenList tokens={tokens} selected={token.asset_id} onSelect={(asset) => select({ asset })} />
            <Card className="flex flex-col gap-3 p-[18px]">
              <Stat
                label={`Your ${token.symbol}`}
                value={tokenAmount(position?.total ?? "0", token.symbol)}
                detail={usd(position?.value ?? (position ? null : 0))}
              />
              <div className="flex flex-col gap-1">
                <Label>Cash available</Label>
                <Mono className="text-lg">{usd(cash?.available ?? 0)}</Mono>
              </div>
            </Card>
          </div>
          <Ticket
            key={`${token.asset_id}:${side}`}
            token={token}
            side={side}
            onSide={(s) => select({ side: s })}
            position={position}
            cash={cash}
            evidence={ev}
            selection={effective}
            dryRun={guard.data?.dry_run ?? true}
          />
          {evidenceAsset ? (
            <EvidencePanel asset={evidenceAsset} evidence={ev} selection={effective} onChange={setSelection} loading={evidence.isPending} />
          ) : (
            <Banner title="No evidence for this token">IDT only trades BTC and ETH, the assets with prediction-market ladders.</Banner>
          )}
        </div>
      )}
    </Page>
  );
}
