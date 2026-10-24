"""Snapshot every SNAPSHOT_INTERVAL_MINUTES: write ladders to Snowflake, detect shifts, fetch X posts.

Usage: python scripts/snapshot_loop.py [--once]
"""
import argparse
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from idt import config  # noqa: E402
from idt.snapshots import Snapshotter  # noqa: E402
from idt.store import snowflake as store  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="take one snapshot and wait for any x_search to finish")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("snowflake.connector").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    store.ensure_schema()
    s = Snapshotter()
    s.warm()
    interval = config.SNAPSHOT_INTERVAL_MINUTES * 60
    while True:
        started = time.monotonic()
        s.tick()
        if args.once:
            s.pool.shutdown(wait=True)
            return
        time.sleep(max(5.0, interval - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
