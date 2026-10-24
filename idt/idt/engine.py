"""Assemble per-venue, per-date distributions plus the True Markets spot reference."""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from dataclasses import asdict
from datetime import datetime, timezone

import httpx

from idt import config
from idt.model.distribution import fit
from idt.model.ladder import Contract, Ladder, build_ladder
from idt.sources import kalshi, polymarket

log = logging.getLogger(__name__)

MIN_POINTS = 3

CAVEATS = [
    "Prediction-market prices are not pure probabilities: fees, spreads and risk premia distort them.",
    "Venues resolve on different reference prices and times; read each venue's resolution rules.",
    "Between strikes the curve is linear; the distribution is only as fine as the strike grid.",
]


class TTLCache:
    def __init__(self, ttl_s: float):
        self.ttl_s = ttl_s
        self._d: dict = {}
        self._lock = threading.Lock()

    def get(self, key, fn):
        with self._lock:
            hit = self._d.get(key)
            if hit and time.monotonic() - hit[0] < self.ttl_s:
                return hit[1]
        value = fn()
        with self._lock:
            self._d[key] = (time.monotonic(), value)
        return value


_contracts_cache = TTLCache(30)
_spot_cache = TTLCache(15)
_tm = None


def _truemarkets():
    global _tm
    if _tm is None:
        from idt.sources.truemarkets_client import TrueMarkets
        _tm = TrueMarkets()
    return _tm


def spot(asset: str) -> dict:
    """Mid of a $10 BUY and SELL quote on True Markets; the gap is reported, not hidden."""
    def get():
        tm = _truemarkets()
        buy = tm.quote(asset, "buy", 10)
        sell = tm.quote(asset, "sell", 10)
        ask, bid = float(buy["price"]), float(sell["price"])
        mid = (ask + bid) / 2
        return {"asset": asset, "mid": mid, "bid": bid, "ask": ask,
                "spread_bps": (ask - bid) / mid * 1e4,
                "taken_at": datetime.now(timezone.utc).isoformat(),
                "source": "True Markets compute_quote, $10 BUY vs SELL",
                "quotes": {"buy": buy, "sell": sell}}
    return _spot_cache.get(asset, get)


def contracts(asset: str) -> tuple[list[Contract], list[dict]]:
    def get():
        with httpx.Client(timeout=30) as client:
            pc, pr = polymarket.fetch_contracts(asset, client)
            kc, kr = kalshi.fetch_contracts(asset, client)
        return pc + kc, pr + kr
    return _contracts_cache.get(asset, get)


def ladders(asset: str) -> list[Ladder]:
    groups: dict[tuple, list[Contract]] = defaultdict(list)
    for c in contracts(asset)[0]:
        groups[(c.venue, c.resolution_at)].append(c)
    out = []
    for (_, _), cs in sorted(groups.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        lad = build_ladder(cs, max_spread=config.MAX_SPREAD, min_volume=config.MIN_VOLUME)
        if len(lad.points) >= MIN_POINTS:
            out.append(lad)
    return out


def catalog(asset: str) -> list[dict]:
    return [{"venue": lad.venue, "resolution_at": lad.resolution_at.isoformat(),
             "n_points": len(lad.points), "n_dropped": len(lad.dropped)} for lad in ladders(asset)]


def describe(lad: Ladder, spot_mid: float | None) -> dict:
    d = fit([p.strike for p in lad.points], [p.prob for p in lad.points], [p.weight for p in lad.points])
    by_strike = {p.strike: p for p in lad.points}
    points = [{
        "strike": k, "raw": raw, "fitted": f,
        "bid": by_strike[k].bid, "ask": by_strike[k].ask, "volume": by_strike[k].volume,
        "market_ids": by_strike[k].market_ids, "from_last": by_strike[k].from_last,
    } for k, raw, f in zip(d.strikes, d.raw, d.fitted)]
    out = {
        "asset": lad.asset,
        "venue": lad.venue,
        "resolution_at": lad.resolution_at.isoformat(),
        "rules": lad.rules,
        "overround": lad.overround,
        "points": points,
        "dropped": [asdict(x) for x in lad.dropped],
        "coherence_score": d.coherence_score,
        "buckets": [asdict(b) for b in d.buckets],
        "quantiles": [asdict(q) for q in d.quantiles],
        "mean": d.mean,
        "mean_assumption": d.mean_assumption,
        "iqr": d.iqr,
        "iqr_over_median": d.iqr_over_median,
        "p_above_spot": asdict(d.survival(spot_mid)) if spot_mid else None,
        "caveats": CAVEATS,
    }
    return out


def distribution(asset: str, venue: str, resolution_at: str) -> dict | None:
    target = datetime.fromisoformat(resolution_at)
    lad = next((x for x in ladders(asset) if x.venue == venue and x.resolution_at == target), None)
    if lad is None:
        return None
    s = _safe_spot(asset)
    return {**describe(lad, s["mid"] if s else None), "spot": s}


def snapshot(asset: str) -> dict:
    s = _safe_spot(asset)
    return {"asset": asset, "taken_at": datetime.now(timezone.utc).isoformat(), "spot": s,
            "distributions": [describe(lad, s["mid"] if s else None) for lad in ladders(asset)]}


def _safe_spot(asset: str) -> dict | None:
    try:
        return spot(asset)
    except Exception:  # noqa: BLE001 - the curve is still useful without spot
        log.exception("spot quote failed for %s", asset)
        return None
