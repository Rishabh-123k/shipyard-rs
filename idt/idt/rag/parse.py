"""Rule-based question parsing and answer guards for the grounded Ask path."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

ASSET_RE = {
    "BTC": re.compile(r"\b(btc|bitcoin|xbt)\b", re.I),
    "ETH": re.compile(r"\b(eth|ether|ethereum)\b", re.I),
}
VENUE_RE = {"polymarket": re.compile(r"\bpoly(market)?\b", re.I), "kalshi": re.compile(r"\bkalshi\b", re.I)}
LAST_RE = re.compile(r"\b(?:last|past)\s+(\d+)\s*(minute|min|hour|hr|day)s?\b", re.I)
NUMBER_RE = re.compile(r"(?<![A-Za-z\d.])\$?\d[\d,]*(?:\.\d+)?%?")
CITE_RE = re.compile(r"\[([EP]\d+)\]")


@dataclass
class Query:
    text: str
    assets: list[str]
    venue: str | None
    start: datetime
    end: datetime
    window_label: str


def parse_question(text: str, now: datetime) -> Query:
    assets = [a for a, rx in ASSET_RE.items() if rx.search(text)] or list(ASSET_RE)
    venue = next((v for v, rx in VENUE_RE.items() if rx.search(text)), None)
    start, end, label = _window(text.lower(), now)
    return Query(text, assets, venue, start, end, label)


def _window(t: str, now: datetime) -> tuple[datetime, datetime, str]:
    local = now.astimezone(ET)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    m = LAST_RE.search(t)
    if m:
        n, unit = int(m.group(1)), m.group(2).lower()
        delta = timedelta(minutes=n) if unit.startswith("min") else timedelta(days=n) if unit == "day" else timedelta(hours=n)
        return now - delta, now, f"last {n} {unit}{'s' if n != 1 else ''}"
    if "this morning" in t:
        return midnight, min(now, midnight + timedelta(hours=12)), "this morning (ET)"
    if "this afternoon" in t:
        return midnight + timedelta(hours=12), min(now, midnight + timedelta(hours=18)), "this afternoon (ET)"
    if "overnight" in t or "last night" in t:
        return midnight - timedelta(hours=6), min(now, midnight + timedelta(hours=8)), "overnight (ET)"
    if "yesterday" in t:
        return midnight - timedelta(days=1), midnight, "yesterday (ET)"
    if "today" in t:
        return midnight, now, "today (ET)"
    if "this week" in t:
        return midnight - timedelta(days=local.weekday()), now, "this week (ET)"
    return now - timedelta(hours=24), now, "last 24 hours"


def _norm(n: str) -> str:
    s = n.replace("$", "").replace(",", "").rstrip("%")
    return s.rstrip("0").rstrip(".") if "." in s else s


def unsupported_numbers(answer: str, context: str) -> list[str]:
    """Numbers in the answer that don't appear in the evidence context (citation markers excluded)."""
    allowed = {_norm(n) for n in NUMBER_RE.findall(context)}
    stripped = CITE_RE.sub("", answer)
    return [n for n in NUMBER_RE.findall(stripped) if _norm(n) not in allowed]


BARE_REF_RE = re.compile(r"(?<!\[)\b([EP]\d+)\b(?!\])")


def bracket_refs(answer: str, valid_ids: set[str]) -> str:
    """Models sometimes write 'P2' instead of '[P2]'; bracket bare references to known evidence IDs."""
    return BARE_REF_RE.sub(lambda m: f"[{m.group(1)}]" if m.group(1) in valid_ids else m.group(0), answer)


def enforce(answer: str, context: str, valid_ids: set[str]) -> tuple[str, list[str]]:
    """Drop sentences with unsupported numbers and strip unknown citation markers."""
    warnings: list[str] = []
    answer = bracket_refs(answer, valid_ids)
    sentences = re.split(r"(?<=[.!?])\s+", answer.strip())
    kept = []
    for s in sentences:
        bad = unsupported_numbers(s, context)
        if bad:
            warnings.append(f"removed a sentence with numbers not in the evidence: {', '.join(bad)}")
            continue
        unknown = [c for c in CITE_RE.findall(s) if c not in valid_ids]
        if unknown:
            warnings.append(f"removed unknown citations: {', '.join(unknown)}")
            s = CITE_RE.sub(lambda m: "" if m.group(1) in unknown else m.group(0), s)
        kept.append(s.strip())
    return " ".join(k for k in kept if k), warnings


def cited_ids(answer: str) -> list[str]:
    seen: list[str] = []
    for c in CITE_RE.findall(answer):
        if c not in seen:
            seen.append(c)
    return seen
