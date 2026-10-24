"""Probe True Markets Gateway: list_assets, balances, BUY/SELL quotes. Read-only."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from idt.config import FIXTURES, TM_KEY_FILE  # noqa: E402
from idt.sources.truemarkets_client import TrueMarkets  # noqa: E402


def save(name: str, data) -> None:
    FIXTURES.mkdir(exist_ok=True)
    (FIXTURES / f"truemarkets_{name}.json").write_text(json.dumps(data, indent=2, default=str))
    print(f"saved fixtures/truemarkets_{name}.json")


def main() -> None:
    if not TM_KEY_FILE:
        sys.exit("TM_KEY_FILE not set in .env")
    tm = TrueMarkets()
    print("gateway ops:", [n for n in dir(tm.gateway) if not n.startswith("_")])
    assets = tm.list_assets()
    save("list_assets", assets)
    for a in assets.get("data") or []:
        if a.get("tradeable"):
            print(f" - {a.get('symbol'):8} chain={a.get('chain')} stable={a.get('stable')} id={a.get('id')}")

    bal = tm.balances()
    save("balances", bal)
    print("balances:", json.dumps(bal)[:400])

    for base in ("BTC", "ETH"):
        for side in ("buy", "sell"):
            try:
                q = tm.quote(base, side, 10)
            except Exception as e:  # noqa: BLE001 - probe reports any failure
                q = {"error": repr(e)}
            print(base, side, q)
            save(f"quote_{base}_{side}", q)
    tm.close()


if __name__ == "__main__":
    main()
