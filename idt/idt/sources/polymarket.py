"""Polymarket discovery + 'above $K on D' ladder parsing (Gamma API, no auth)."""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx

from idt.config import POLYMARKET_GAMMA
from idt.model.ladder import Contract

log = logging.getLogger(__name__)

VENUE = "polymarket"
NAMES = {"BTC": "Bitcoin", "ETH": "Ethereum"}
ET = ZoneInfo("America/New_York")

EVENT_RE = re.compile(r"^(Bitcoin|Ethereum) above ___ on ([A-Z][a-z]+ \d{1,2})\?$")
QUESTION_RE = re.compile(
    r"^Will the price of (Bitcoin|Ethereum) be above \$(\d{1,3}(?:,\d{3})*(?:\.\d+)?) on ([A-Z][a-z]+ \d{1,2})\?$"
)


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def search_events(asset: str, client: httpx.Client) -> list[dict]:
    """All active events matching '<Name> above', following public-search pagination."""
    q = f"{NAMES[asset]} above"
    events, page = [], 1
    while True:
        r = client.get(f"{POLYMARKET_GAMMA}/public-search",
                       params={"q": q, "page": page, "events_status": "active"})
        r.raise_for_status()
        body = r.json()
        events += body.get("events") or []
        if not (body.get("pagination") or {}).get("hasMore") or page >= 10:
            return events
        page += 1


def parse_event(event: dict, asset: str, now: datetime) -> tuple[list[Contract], list[dict]]:
    """Return (contracts, rejected). Strike and date come only from the strict regexes."""
    rejected: list[dict] = []
    m = EVENT_RE.match(event.get("title", ""))
    if not m or m.group(1) != NAMES[asset]:
        return [], [{"id": event.get("id"), "title": event.get("title"), "reason": "event title not a price ladder"}]
    end = event.get("endDate")
    if not end or _ts(end) <= now:
        return [], [{"id": event.get("id"), "title": event.get("title"), "reason": "event already resolved"}]

    contracts = []
    for mk in event.get("markets") or []:
        question = mk.get("question", "")
        qm = QUESTION_RE.match(question)
        if not qm or qm.group(1) != NAMES[asset]:
            rejected.append({"id": mk.get("id"), "title": question, "reason": "question did not match strict regex"})
            continue
        resolution_at = _ts(mk.get("endDate") or end)
        if resolution_at.astimezone(ET).strftime("%B %-d") != qm.group(3):
            rejected.append({"id": mk.get("id"), "title": question,
                             "reason": f"title date {qm.group(3)} != endDate {resolution_at.isoformat()}"})
            continue
        if mk.get("closed") or not mk.get("active", True):
            rejected.append({"id": mk.get("id"), "title": question, "reason": "market closed"})
            continue
        # Gamma omits bestBid/bestAsk when that side of the book is empty.
        ask = mk.get("bestAsk")
        bid = mk.get("bestBid")
        token_id = _yes_token(mk)
        contracts.append(Contract(
            venue=VENUE,
            market_id=str(mk.get("conditionId") or mk.get("id")),
            asset=asset,
            resolution_at=resolution_at,
            kind="above",
            bid=float(bid) if bid is not None else 0.0,
            ask=float(ask) if ask is not None else 1.0,
            volume=float(mk.get("volumeNum") or 0.0),
            last=float(mk["lastTradePrice"]) if mk.get("lastTradePrice") is not None else None,
            strike=float(qm.group(2).replace(",", "")),
            rules=mk.get("description", ""),
            title=question,
            token_id=token_id,
        ))
    return contracts, rejected


def _yes_token(mk: dict) -> str | None:
    try:
        outcomes = json.loads(mk.get("outcomes") or "[]")
        tokens = json.loads(mk.get("clobTokenIds") or "[]")
        return tokens[outcomes.index("Yes")]
    except (ValueError, IndexError, TypeError):
        return None


def price_history(token_id: str, start: int, end: int, bucket_seconds: int,
                  client: httpx.Client) -> list[tuple[int, float]]:
    """Polymarket prices-history: one price per bucket (trade-based, not a two-sided quote)."""
    r = client.get("https://data-api.polymarket.com/v2/prices-history",
                   params={"token_id": token_id, "start": start, "end": end, "bucket_seconds": bucket_seconds})
    r.raise_for_status()
    return [(int(p["timestamp"]), float(p["price"])) for p in r.json().get("data") or []]


def fetch_contracts(asset: str, client: httpx.Client | None = None,
                    now: datetime | None = None) -> tuple[list[Contract], list[dict]]:
    now = now or datetime.now(timezone.utc)
    own = client is None
    client = client or httpx.Client(timeout=30)
    try:
        contracts, rejected = [], []
        for ev in search_events(asset, client):
            c, r = parse_event(ev, asset, now)
            contracts += c
            rejected += r
    finally:
        if own:
            client.close()
    for r in rejected:
        log.info("polymarket drop %s: %s", r["title"], r["reason"])
    return contracts, rejected
