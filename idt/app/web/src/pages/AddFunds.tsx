import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useMe } from "../api.ts";
import { Page } from "../components/AppShell.tsx";
import { AssetTile, Banner, Button, Card, Label, Spinner } from "../components/ui.tsx";
import type { Wallet } from "../types.ts";

const CHAINS: Record<string, { name: string; symbol: string; note: string }> = {
  solana: { name: "Solana", symbol: "SOL", note: "Send USDC or SOL on Solana to trade Solana tokens." },
  evm: { name: "Base", symbol: "ETH", note: "Send USDC or ETH on Base to trade Base tokens. The same address also holds Ethereum tokens." },
};

function WalletCard({ wallet }: { wallet: Wallet }) {
  const [copied, setCopied] = useState(false);
  const chain = CHAINS[wallet.chain_family] ?? { name: wallet.chain_family, symbol: wallet.chain_family, note: "" };

  async function copy() {
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="flex items-center gap-7 p-7">
      <div className="shrink-0 rounded-2xl bg-text p-3">
        <QRCodeSVG value={wallet.address} size={152} bgColor="#F4F0FF" fgColor="#0D0A17" title={`${chain.name} address QR code`} />
      </div>
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex items-center gap-2.5">
          <AssetTile symbol={chain.symbol} size={32} />
          <h2 className="m-0 text-[19px] font-bold">{chain.name}</h2>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Your address</Label>
          <span className="font-mono text-sm leading-normal break-all">{wallet.address}</span>
        </div>
        {chain.note && <p className="m-0 text-sm leading-snug text-muted">{chain.note}</p>}
        <div>
          <Button className="h-11 rounded-xl px-5 text-sm" onClick={copy}>
            {copied ? "Copied" : "Copy address"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function AddFunds() {
  const me = useMe();

  return (
    <Page title="Add funds" subtitle="Send crypto from any wallet or exchange to your Tensho address.">
      {me.isPending && <Spinner />}
      {me.data && me.data.wallets.length === 0 && (
        <Banner title="Your wallet is still being set up">Sign in again to finish creating your addresses.</Banner>
      )}
      <div className="grid grid-cols-2 gap-5">
        {me.data?.wallets.map((wallet) => <WalletCard key={wallet.address} wallet={wallet} />)}
      </div>
      <Banner title="Match the network to the address">
        Tokens sent on the wrong network can be lost for good. This app uses real funds; there is no test mode.
      </Banner>
      <p className="m-0 text-sm text-muted">
        Deposits appear in your balance once the network confirms them, usually within a minute on Solana.
      </p>
    </Page>
  );
}
