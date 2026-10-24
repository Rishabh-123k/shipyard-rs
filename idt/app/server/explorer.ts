// Mirrors the explorer pages conductor links on its list and feed reads.
const TX_PAGES: Record<string, string> = {
  solana: "https://solscan.io/tx/",
  base: "https://basescan.org/tx/",
};

export function explorerTxUrl(chain: string | null | undefined, txHash: string | undefined): string | undefined {
  const page = chain ? TX_PAGES[chain] : undefined;
  return page && txHash ? page + txHash : undefined;
}
