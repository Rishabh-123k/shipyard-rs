"""Backfill hourly snapshots + shift events from venue price history, then x_search the biggest shifts.

Usage: python scripts/backfill.py [--hours 24] [--searches 3] [--replace]
"""
import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from idt import backfill  # noqa: E402
from idt.store import snowflake as store  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--step-minutes", type=int, default=60)
    ap.add_argument("--searches", type=int, default=3, help="x_search windows per asset (each runs open + curated)")
    ap.add_argument("--replace", action="store_true", help="delete earlier backfill rows first")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("snowflake.connector").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    store.ensure_schema()
    existing = store.query("SELECT COUNT(*) AS n FROM SNAPSHOTS WHERE source = 'backfill'")[0]["n"]
    if existing and not args.replace:
        sys.exit(f"{existing} backfill snapshots already exist; pass --replace to rebuild them")
    if existing:
        store.delete_backfill()
    print(backfill.run(args.hours, args.step_minutes, args.searches))


if __name__ == "__main__":
    main()
