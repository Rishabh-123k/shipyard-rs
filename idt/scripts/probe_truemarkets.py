"""Probe True Markets Gateway: list_assets, balances, BUY/SELL quotes. Read-only."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from idt.config import FIXTURES, TM_KEY_FILE  # noqa: E402
from truemarkets import Client  # noqa: E402
from truemarkets._generated.gateway.models import OrderSide, QuoteRequest, QuoteRequestQtyUnit  # noqa: E402


def dump(obj):
    return obj.to_dict() if hasattr(obj, "to_dict") else repr(obj)


def save(name: str, data) -> None:
    FIXTURES.mkdir(exist_ok=True)
    (FIXTURES / f"truemarkets_{name}.json").write_text(json.dumps(data, indent=2, default=str))
    print(f"saved fixtures/truemarkets_{name}.json")


def main() -> None:
    if not TM_KEY_FILE:
        sys.exit("TM_KEY_FILE not set in .env")
    with Client(key_file=TM_KEY_FILE) as c:
        print("gateway ops:", [n for n in dir(c.gateway) if not n.startswith("_")])
        assets = dump(c.gateway.list_assets())
        save("list_assets", assets)
        for a in (assets.get("data") or []) if isinstance(assets, dict) else []:
            print(f" - {a.get('symbol'):8} tradeable={a.get('tradeable')} chain={a.get('chain')} id={a.get('id')}")

        save("balances", dump(c.gateway.get_balances()))

        for side in (OrderSide.BUY, OrderSide.SELL):
            for base in ("BTC", "ETH"):
                body = QuoteRequest(base_asset=base, quote_asset="USDC", qty="10",
                                    qty_unit=QuoteRequestQtyUnit.QUOTE, side=side)
                q = dump(c.gateway.compute_quote(body=body))
                print(base, side.value, q)
                save(f"quote_{base}_{side.value}", q)


if __name__ == "__main__":
    main()
