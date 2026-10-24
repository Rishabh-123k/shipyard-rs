import { Link } from "react-router";
import { useAssets, useMe, usePortfolio, useTransactions } from "../api.ts";
import { Page } from "../components/AppShell.tsx";
import { AssetTile, Banner, ButtonLink, Card, GridHorizon, Label, Mono, PriceChange, Spinner, TxAmount, TxGlyph } from "../components/ui.tsx";
import { chainName, describeTransaction, holdings, percent, relativeTime, signedUsd, tokenAmount, toRatio, usd } from "../format.ts";

function greeting(hour = new Date().getHours()): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const HOLDING_GRID = "grid grid-cols-[2.2fr_1.3fr_1fr_1fr_0.8fr] items-center";

export function Home() {
  const me = useMe();
  const ready = me.data?.ready ?? false;
  const portfolio = usePortfolio();
  const assets = useAssets();
  const transactions = useTransactions();

  const unpriced = portfolio.data?.priced === false;
  const priced = portfolio.data?.priced === false ? undefined : portfolio.data;
  const rows = holdings(portfolio.data, assets.data)
    .filter((h) => h.cash || Number(h.total) > 0)
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const unpricedTotal = rows.reduce((sum, h) => sum + (h.value ?? 0), 0);
  const total = priced ? Number(priced.total_usd) : unpriced ? unpricedTotal : null;

  return (
    <Page title={greeting()} subtitle="Here is where your money stands.">
      {!ready && (
        <Banner title="Your wallet is still being set up">
          Sign in again to retry.{me.data?.warning && ` (${me.data.warning})`}
        </Banner>
      )}
      {unpriced && <Banner>Portfolio pricing unavailable; showing live market prices.</Banner>}
      {portfolio.error && <Banner tone="error">{portfolio.error.message}</Banner>}

      <div className="grid grid-cols-[2fr_1fr] gap-5">
        <Card className="relative flex h-[190px] flex-col gap-2 overflow-hidden p-7">
          <GridHorizon />
          <span className="relative">
            <Label>Total balance</Label>
          </span>
          <Mono className="relative text-[52px] leading-tight">{total === null ? "—" : usd(total)}</Mono>
          {priced && (
            <Mono className={`relative text-[15px] ${Number(priced.change_24h_usd) < 0 ? "text-down" : "text-up"}`}>
              {signedUsd(priced.change_24h_usd)} ({percent(toRatio(priced.change_24h_pct, 100))}) today
            </Mono>
          )}
        </Card>
        <Card className="grid h-[190px] grid-cols-2 content-center gap-2.5 p-[22px]">
          <ButtonLink to="/trade">Buy</ButtonLink>
          <ButtonLink to="/trade?side=sell" variant="secondary">
            Sell
          </ButtonLink>
          <ButtonLink to="/add-funds" variant="secondary">
            Add funds
          </ButtonLink>
          <ButtonLink to="/send" variant="secondary">
            Send
          </ButtonLink>
        </Card>
      </div>

      <div className="grid flex-1 grid-cols-[2fr_1fr] gap-5">
        <Card className="flex flex-col px-[26px] py-[22px]">
          <h2 className="m-0 mb-2 text-[17px] font-bold">Holdings</h2>
          <div className={`${HOLDING_GRID} border-b border-edge py-2.5 text-xs tracking-[0.08em] text-muted`}>
            <span>ASSET</span>
            <span className="text-right">BALANCE</span>
            <span className="text-right">PRICE</span>
            <span className="text-right">VALUE</span>
            <span className="text-right">24H</span>
          </div>
          {portfolio.isLoading && (
            <div className="py-6">
              <Spinner />
            </div>
          )}
          {rows.map((h) => (
            <div key={`${h.symbol}:${h.chain}`} className={`${HOLDING_GRID} border-b border-line py-3.5`}>
              <div className="flex items-center gap-3">
                <AssetTile symbol={h.symbol} icon={h.icon} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold">{h.cash ? `Cash (${h.symbol})` : h.name}</span>
                  <span className="text-xs text-muted">{chainName(h.chain)}</span>
                </span>
              </div>
              <Mono className="text-right text-sm">{tokenAmount(h.total, h.symbol)}</Mono>
              <Mono className="text-right text-sm text-muted">{usd(h.price)}</Mono>
              <Mono className="text-right text-sm">{usd(h.value)}</Mono>
              <PriceChange ratio={h.change} className="text-right text-sm" />
            </div>
          ))}
          {ready && !portfolio.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted">
              Nothing here yet. <Link to="/add-funds">Add funds</Link> to get started.
            </p>
          )}
        </Card>

        <Card className="flex flex-col px-[26px] py-[22px]">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="m-0 text-[17px] font-bold">Recent activity</h2>
            <Link to="/activity" className="text-sm">
              View all
            </Link>
          </div>
          {transactions.data?.data.slice(0, 3).map((tx) => {
            const view = describeTransaction(tx, assets.data);
            return (
              <div key={tx.id} className="flex items-center gap-3 border-b border-line py-3">
                <TxGlyph glyph={view.glyph} color={view.glyphColor} />
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="text-sm font-bold">{view.title}</span>
                  <span className="text-xs text-muted">{relativeTime(tx.created_at)}</span>
                </div>
                <TxAmount amount={view.amount} value={view.value} />
              </div>
            );
          })}
          {transactions.data?.data.length === 0 && <p className="text-sm text-muted">No activity yet.</p>}
        </Card>
      </div>
    </Page>
  );
}
