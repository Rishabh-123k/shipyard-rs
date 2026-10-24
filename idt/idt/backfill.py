"""Rebuild hourly snapshots for currently open ladders from venue price history.

Kalshi candlesticks carry bid/ask closes, so Kalshi curves use real mids. Polymarket history is one
trade-based price per bucket, so those points are flagged as last-price fallbacks (from_last=True).
Spot comes from True Markets' public DeFi price history (cbBTC for BTC).
"""
from __future__ import annotations

import bisect
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import httpx

from idt import config, engine
from idt.model.ladder import Contract, build_ladder
from idt.snapshots import Snapshotter
from idt.sources import kalshi, polymarket
from idt.sources.truemarkets_client import SPOT_HISTORY_SYMBOL, spot_history
from idt.store import snowflake as store

log = logging.getLogger(__name__)


def _latest_at(series: list[tuple], t: int, max_age: int):
    """Latest entry with ts <= t and no older than max_age seconds."""
    i = bisect.bisect_right([s[0] for s in series], t) - 1
    if i < 0 or t - series[i][0] > max_age:
        return None
    return series[i]


def _history(c: Contract, start: int, end: int, step_s: int, client: httpx.Client) -> list[tuple]:
    try:
        if c.venue == "polymarket" and c.token_id:
            return polymarket.price_history(c.token_id, start, end, step_s, client)
        if c.venue == "kalshi":
            return kalshi.candles(kalshi.ABOVE_SERIES[c.asset], c.market_id, start, end, step_s // 60, client)
    except httpx.HTTPError as e:
        log.warning("history failed for %s: %s", c.market_id, e)
    return []


def contracts_at(contracts: list[Contract], hist: dict[str, list[tuple]], t: int, step_s: int) -> list[Contract]:
    out = []
    for c in contracts:
        row = _latest_at(hist.get(c.market_id, []), t, 2 * step_s)
        if row is None:
            continue
        if c.venue == "polymarket":
            out.append(replace(c, bid=None, ask=None, last=row[1], volume=0.0))
        else:
            out.append(replace(c, bid=row[1], ask=row[2], volume=0.0))
    return out


def run(hours: int = 24, step_minutes: int = 60, searches_per_asset: int = 3) -> dict:
    now = datetime.now(timezone.utc)
    step = timedelta(minutes=step_minutes)
    end = datetime.fromtimestamp((int(now.timestamp()) // int(step.total_seconds())) * int(step.total_seconds()), timezone.utc)
    times = [end - step * k for k in range(int(hours * 60 / step_minutes), 0, -1)]
    start_ts, end_ts, step_s = int(times[0].timestamp()) - 2 * int(step.total_seconds()), int(end.timestamp()), int(step.total_seconds())

    snap = Snapshotter()
    run_id = f"backfill-{store.new_id()[:12]}"
    all_events: dict[str, list[dict]] = defaultdict(list)
    n_snaps = 0

    for asset in SPOT_HISTORY_SYMBOL:
        spots = spot_history(asset, "24h" if hours <= 24 else "7d", "5m" if hours <= 24 else "1h")
        spot_ts = [(int(t.timestamp()), p) for t, p in spots]
        live = [c for c in engine.contracts(asset)[0]
                if c.venue in ("polymarket", "kalshi")
                and c.resolution_at - now > timedelta(hours=config.SHIFT_MIN_HOURS_TO_RESOLUTION)]
        with httpx.Client(timeout=30) as client, ThreadPoolExecutor(max_workers=3) as pool:
            hist = dict(zip([c.market_id for c in live],
                            pool.map(lambda c: _history(c, start_ts, end_ts, step_s, client), live)))
        ladders: dict[tuple, list[Contract]] = defaultdict(list)
        for c in live:
            ladders[(c.venue, c.resolution_at)].append(c)
        log.info("%s: %d ladders, %d contracts with history", asset, len(ladders), sum(1 for v in hist.values() if v))

        for t in times:
            ts = int(t.timestamp())
            sp = _latest_at(spot_ts, ts, 3600)
            spot = {"asset": asset, "mid": sp[1], "bid": None, "ask": None, "spread_bps": None,
                    "taken_at": t.isoformat(),
                    "source": f"True Markets DeFi price history ({SPOT_HISTORY_SYMBOL[asset]})"} if sp else None
            dists = []
            for cs in ladders.values():
                at_t = contracts_at(cs, hist, ts, step_s)
                if len(at_t) < 3:
                    continue
                lad = build_ladder(at_t, max_spread=config.MAX_SPREAD, min_volume=0, use_last=True)
                if len(lad.points) >= engine.MIN_POINTS:
                    dists.append(engine.describe(lad, spot["mid"] if spot else None))
            all_events[asset] += snap.ingest(asset, dists, spot, t, run_id, source="backfill", search=False)
            n_snaps += len(dists)
        store.embed_pending()

    searched = 0
    for asset, events in all_events.items():
        picked: list[dict] = []
        for e in sorted(events, key=lambda e: -e["score"]):
            if len(picked) >= searches_per_asset:
                break
            t = datetime.fromisoformat(e["window_end"])
            if all(abs(t - datetime.fromisoformat(p["window_end"])) > timedelta(hours=2) for p in picked):
                picked.append(e)
        for e in picked:
            # Group every event of this asset in the same window so they share the evidence.
            group = [x for x in events if x["window_end"] == e["window_end"]]
            snap.search_for(asset, group)
            searched += 1
    log.info("backfill %s: %d snapshots, %d events, %d x_search windows", run_id, n_snaps,
             sum(map(len, all_events.values())), searched)
    return {"run_id": run_id, "snapshots": n_snaps, "events": {a: len(v) for a, v in all_events.items()},
            "searched_windows": searched}
