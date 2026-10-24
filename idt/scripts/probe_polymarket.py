"""Probe Polymarket Gamma + CLOB; save raw JSON fixtures."""
import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from idt.config import FIXTURES, POLYMARKET_CLOB, POLYMARKET_GAMMA  # noqa: E402


def save(name: str, data) -> None:
    FIXTURES.mkdir(exist_ok=True)
    (FIXTURES / f"polymarket_{name}.json").write_text(json.dumps(data, indent=2))
    print(f"saved fixtures/polymarket_{name}.json")


def main() -> None:
    with httpx.Client(timeout=30) as c:
        r = c.get(f"{POLYMARKET_GAMMA}/public-search", params={"q": "bitcoin above"})
        print("public-search", r.status_code)
        search = r.json()
        save("search_bitcoin_above", search)

        events = search.get("events") or []
        print(f"{len(events)} events")
        for ev in events[:15]:
            print(" -", ev.get("title"), "|", ev.get("endDate"), "| markets:", len(ev.get("markets") or []))

        first_market = None
        for ev in events:
            for m in ev.get("markets") or []:
                first_market = m
                break
            if first_market:
                break
        if not first_market:
            print("no markets found")
            return

        print("\nmarket keys:", sorted(first_market.keys()))
        for k in ("question", "outcomes", "outcomePrices", "clobTokenIds", "conditionId", "endDate",
                  "bestBid", "bestAsk", "volume", "volumeNum", "liquidity"):
            print(f"  {k}: {first_market.get(k)!r}")

        tokens = first_market.get("clobTokenIds")
        if isinstance(tokens, str):
            tokens = json.loads(tokens)
        if tokens:
            book = c.get(f"{POLYMARKET_CLOB}/book", params={"token_id": tokens[0]})
            print("\nbook", book.status_code)
            save("book_sample", book.json())


if __name__ == "__main__":
    main()
