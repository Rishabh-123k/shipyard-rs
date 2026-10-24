"""Probe Kalshi public market data; discover BTC/ETH series; save fixtures."""
import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from idt.config import FIXTURES  # noqa: E402

BASES = [
    "https://api.elections.kalshi.com/trade-api/v2",
    "https://external-api.kalshi.com/trade-api/v2",
]


def save(name: str, data) -> None:
    FIXTURES.mkdir(exist_ok=True)
    (FIXTURES / f"kalshi_{name}.json").write_text(json.dumps(data, indent=2))
    print(f"saved fixtures/kalshi_{name}.json")


def main() -> None:
    with httpx.Client(timeout=30) as c:
        base = None
        for b in BASES:
            try:
                r = c.get(f"{b}/series", params={"category": "Crypto"})
                print(b, r.status_code)
                if r.status_code == 200:
                    base = b
                    break
            except httpx.HTTPError as e:
                print(b, "error", e)
        if not base:
            print("no working base")
            return

        series = r.json()
        save("series_crypto", series)
        crypto = series.get("series") or []
        print(f"{len(crypto)} crypto series")
        candidates = [
            s for s in crypto
            if any(w in (s.get("title", "") + s.get("ticker", "")).upper() for w in ("BTC", "BITCOIN", "ETH"))
        ]
        for s in candidates[:30]:
            print(" -", s.get("ticker"), "|", s.get("title"), "|", s.get("frequency"))

        for s in candidates:
            m = c.get(f"{base}/markets", params={"series_ticker": s["ticker"], "status": "open", "limit": 200})
            mk = m.json().get("markets") or []
            if mk:
                print(f"\nseries {s['ticker']}: {len(mk)} open markets")
                save(f"markets_{s['ticker']}", m.json())
                sample = mk[0]
                print("market keys:", sorted(sample.keys()))
                for k in ("ticker", "title", "subtitle", "strike_type", "floor_strike", "cap_strike",
                          "yes_bid_dollars", "yes_ask_dollars", "close_time", "rules_primary", "volume_fp"):
                    print(f"  {k}: {sample.get(k)!r}")
                ob = c.get(f"{base}/markets/{sample['ticker']}/orderbook")
                print("orderbook", ob.status_code)
                save("orderbook_sample", ob.json())
                break


if __name__ == "__main__":
    main()
