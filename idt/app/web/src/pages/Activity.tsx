import { useState } from "react";
import { useAssets, useTransactions } from "../api.ts";
import { Page } from "../components/AppShell.tsx";
import { Banner, Card, Spinner, TxAmount, TxGlyph } from "../components/ui.tsx";
import { describeTransaction, relativeTime } from "../format.ts";
import type { TransactionDetail } from "../types.ts";

const FILTERS: { label: string; type?: TransactionDetail["type"] }[] = [
  { label: "All" },
  { label: "Trades", type: "order" },
  { label: "Sends", type: "transfer" },
];

const STATUS: Record<TransactionDetail["status"], { label: string; color: string; dot: string }> = {
  completed: { label: "Completed", color: "text-up", dot: "bg-up" },
  pending: { label: "Pending", color: "text-amber", dot: "bg-amber" },
  failed: { label: "Failed", color: "text-down", dot: "bg-down" },
  canceled: { label: "Canceled", color: "text-down", dot: "bg-down" },
};

const ROW_GRID = "grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,0.6fr)] items-center";

export function Activity() {
  const transactions = useTransactions();
  const assets = useAssets();
  const [filter, setFilter] = useState(FILTERS[0]!);

  const rows = (transactions.data?.data ?? []).filter((tx) => !filter.type || tx.type === filter.type);

  return (
    <Page title="Activity" subtitle="Every trade and send on your account.">
      <div className="flex gap-2">
        {FILTERS.map((f) => {
          const active = f.label === filter.label;
          return (
            <button
              key={f.label}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f)}
              className={`h-[38px] cursor-pointer rounded-full border px-[18px] text-sm font-bold ${
                active ? "border-accent bg-accent text-ink" : "border-edge bg-transparent text-muted hover:text-text"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {transactions.error && <Banner tone="error">{transactions.error.message}</Banner>}

      <Card className="flex-1 px-[26px] pt-2 pb-3">
        <div className={`${ROW_GRID} border-b border-edge py-3.5 text-xs tracking-[0.08em] text-muted`}>
          <span>ACTIVITY</span>
          <span className="text-right">AMOUNT</span>
          <span className="pl-8">STATUS</span>
          <span>DATE</span>
          <span className="text-right">TX</span>
        </div>
        {transactions.isLoading && (
          <div className="py-6">
            <Spinner />
          </div>
        )}
        {rows.map((tx) => {
          const view = describeTransaction(tx, assets.data);
          const status = STATUS[tx.status];
          return (
            <div key={tx.id} className={`${ROW_GRID} border-b border-line py-3.5`}>
              <div className="flex items-center gap-3">
                <TxGlyph glyph={view.glyph} color={view.glyphColor} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[15px] font-bold">{view.title}</span>
                  <span className="truncate text-xs text-muted" title={view.detail}>
                    {view.detail}
                  </span>
                </div>
              </div>
              <TxAmount amount={view.amount} value={view.value} />
              <span className={`flex items-center gap-2 pl-8 text-sm ${status.color}`}>
                <span className={`size-2 rounded-full ${status.dot}`} />
                {status.label}
              </span>
              <span className="text-sm text-muted">{relativeTime(tx.created_at)}</span>
              <span className="text-right text-sm">
                {tx.explorer_url ? (
                  <a href={tx.explorer_url} target="_blank" rel="noreferrer">
                    View
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </span>
            </div>
          );
        })}
        {!transactions.isLoading && rows.length === 0 && <p className="py-6 text-sm text-muted">Nothing here yet.</p>}
      </Card>
    </Page>
  );
}
