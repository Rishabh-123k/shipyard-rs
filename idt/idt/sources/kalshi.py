"""Kalshi crypto price ladders: above/below series and range series (public market data)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from idt.config import KALSHI_BASE
from idt.model.ladder import Contract

log = logging.getLogger(__name__)

VENUE = "kalshi"
# Discovered from GET /series?category=Crypto (fixtures/kalshi_series_crypto.json).
ABOVE_SERIES = {"BTC": "KXBTCD", "ETH": "KXETHD"}
RANGE_SERIES = {"BTC": "KXBTC", "ETH": "KXETH"}


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _f(v) -> float | None:
    return None if v in (None, "") else float(v)


def list_markets(series: str, client: httpx.Client) -> list[dict]:
    out, cursor = [], None
    while True:
        params = {"series_ticker": series, "status": "open", "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        r = client.get(f"{KALSHI_BASE}/markets", params=params)
        r.raise_for_status()
        body = r.json()
        out += body.get("markets") or []
        cursor = body.get("cursor")
        if not cursor:
            return out


def parse_market(m: dict, asset: str, range_series: bool) -> tuple[Contract | None, str | None]:
    st = m.get("strike_type")
    floor, cap = _f(m.get("floor_strike")), _f(m.get("cap_strike"))
    if range_series:
        if st == "between" and floor is not None and cap is not None:
            kind, kw = "range", {"lo": floor, "hi": cap}
        elif st == "greater" and floor is not None:
            kind, kw = "range", {"lo": floor, "hi": None}
        elif st == "less" and cap is not None:
            kind, kw = "range", {"lo": None, "hi": cap}
        else:
            return None, f"unsupported strike_type {st!r} in range series"
    elif st == "greater" and floor is not None:
        kind, kw = "above", {"strike": floor}
    elif st == "less" and cap is not None:
        kind, kw = "below", {"strike": cap}
    else:
        return None, f"unsupported strike_type {st!r}"

    # Kalshi reports an empty side as bid 0 / ask 1.
    return Contract(
        venue=VENUE,
        market_id=m["ticker"],
        asset=asset,
        resolution_at=_ts(m["close_time"]),
        kind=kind,
        bid=_f(m.get("yes_bid_dollars")),
        ask=_f(m.get("yes_ask_dollars")),
        volume=_f(m.get("volume_fp")) or 0.0,
        last=_f(m.get("last_price_dollars")),
        rules=m.get("rules_primary", ""),
        title=f"{m.get('title', '')} {m.get('yes_sub_title', '')}".strip(),
        **kw,
    ), None


def parse_markets(markets: list[dict], asset: str, range_series: bool,
                  now: datetime) -> tuple[list[Contract], list[dict]]:
    contracts, rejected = [], []
    for m in markets:
        if _ts(m["close_time"]) <= now:
            rejected.append({"id": m["ticker"], "title": m.get("title"), "reason": "already closed"})
            continue
        c, reason = parse_market(m, asset, range_series)
        if reason:
            rejected.append({"id": m["ticker"], "title": m.get("title"), "reason": reason})
        else:
            contracts.append(c)
    return contracts, rejected


def fetch_contracts(asset: str, client: httpx.Client | None = None, now: datetime | None = None,
                    include_ranges: bool = False) -> tuple[list[Contract], list[dict]]:
    """Above/below ladders by default. Range ladders resolve at the same times, so they are opt-in."""
    now = now or datetime.now(timezone.utc)
    own = client is None
    client = client or httpx.Client(timeout=30)
    try:
        contracts, rejected = parse_markets(list_markets(ABOVE_SERIES[asset], client), asset, False, now)
        if include_ranges:
            c, r = parse_markets(list_markets(RANGE_SERIES[asset], client), asset, True, now)
            contracts += [_relabel(x) for x in c]
            rejected += r
    finally:
        if own:
            client.close()
    return contracts, rejected


def candles(series: str, ticker: str, start: int, end: int, period_minutes: int,
            client: httpx.Client) -> list[tuple[int, float | None, float | None]]:
    """(period end ts, yes bid close, yes ask close) per candle."""
    r = _get_with_backoff(client, f"{KALSHI_BASE}/series/{series}/markets/{ticker}/candlesticks",
                          {"start_ts": start, "end_ts": end, "period_interval": period_minutes})
    out = []
    for c in r.json().get("candlesticks") or []:
        bid = _f((c.get("yes_bid") or {}).get("close_dollars"))
        ask = _f((c.get("yes_ask") or {}).get("close_dollars"))
        out.append((int(c["end_period_ts"]), bid, ask))
    return out


def _get_with_backoff(client: httpx.Client, url: str, params: dict, attempts: int = 6) -> httpx.Response:
    """Public Kalshi endpoints rate-limit bursts with 429; back off exponentially."""
    import time
    for i in range(attempts):
        r = client.get(url, params=params)
        if r.status_code != 429:
            r.raise_for_status()
            return r
        time.sleep(float(r.headers.get("Retry-After") or 0.5 * 2 ** i))
    r.raise_for_status()
    return r


def _relabel(c: Contract) -> Contract:
    from dataclasses import replace
    return replace(c, venue=f"{VENUE}-range")
