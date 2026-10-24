"""Normalize venue contracts into survival points (K, S ≈ P(price_D > K))."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Literal

Kind = Literal["above", "below", "range"]

# Weight floor so a zero-spread quote doesn't dominate the fit.
MIN_WEIGHT_SPREAD = 0.01


@dataclass(frozen=True)
class Contract:
    venue: str
    market_id: str
    asset: str
    resolution_at: datetime
    kind: Kind
    bid: float | None
    ask: float | None
    volume: float = 0.0
    last: float | None = None
    strike: float | None = None
    lo: float | None = None
    hi: float | None = None
    rules: str = ""
    title: str = ""
    token_id: str | None = None

    @property
    def spread(self) -> float | None:
        if self.bid is None or self.ask is None:
            return None
        return self.ask - self.bid

    @property
    def mid(self) -> float | None:
        if self.bid is None or self.ask is None:
            return None
        return (self.bid + self.ask) / 2


@dataclass
class SurvivalPoint:
    strike: float
    prob: float
    weight: float
    market_ids: list[str]
    bid: float | None = None
    ask: float | None = None
    volume: float = 0.0
    from_last: bool = False


@dataclass
class Dropped:
    market_id: str
    reason: str


@dataclass
class Ladder:
    asset: str
    venue: str
    resolution_at: datetime
    points: list[SurvivalPoint]
    dropped: list[Dropped] = field(default_factory=list)
    rules: str = ""
    overround: float | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["resolution_at"] = self.resolution_at.isoformat()
        return d


def _price(c: Contract, use_last: bool) -> tuple[float | None, bool, str | None]:
    """Return (price, from_last, drop_reason)."""
    if c.mid is not None:
        return c.mid, False, None
    if use_last and c.last is not None:
        return c.last, True, None
    return None, False, "no two-sided quote"


def _screen(c: Contract, max_spread: float, min_volume: float, use_last: bool) -> tuple[float | None, bool, str | None]:
    if c.volume < min_volume:
        return None, False, f"volume {c.volume:.0f} < floor {min_volume:.0f}"
    if c.spread is not None and c.spread > max_spread:
        return None, False, f"spread {c.spread:.3f} > max {max_spread:.3f}"
    return _price(c, use_last)


def _weight(c: Contract) -> float:
    s = c.spread if c.spread is not None else 1.0
    return 1.0 / max(s, MIN_WEIGHT_SPREAD)


def build_ladder(
    contracts: list[Contract],
    *,
    max_spread: float,
    min_volume: float = 0.0,
    use_last: bool = False,
) -> Ladder:
    """All contracts must share asset, venue and resolution_at."""
    if not contracts:
        raise ValueError("no contracts")
    keys = {(c.asset, c.venue, c.resolution_at) for c in contracts}
    if len(keys) != 1:
        raise ValueError(f"contracts span multiple ladders: {sorted(map(str, keys))}")
    asset, venue, resolution_at = keys.pop()

    dropped: list[Dropped] = []
    points: list[SurvivalPoint] = []
    buckets: list[tuple[Contract, float, bool]] = []

    for c in contracts:
        p, from_last, reason = _screen(c, max_spread, min_volume, use_last)
        if reason:
            dropped.append(Dropped(c.market_id, reason))
            continue
        assert p is not None
        if c.kind == "range":
            buckets.append((c, p, from_last))
            continue
        if c.strike is None:
            dropped.append(Dropped(c.market_id, "missing strike"))
            continue
        prob = p if c.kind == "above" else 1.0 - p
        bid, ask = (c.bid, c.ask) if c.kind == "above" else (
            None if c.ask is None else 1 - c.ask, None if c.bid is None else 1 - c.bid)
        points.append(SurvivalPoint(c.strike, prob, _weight(c), [c.market_id], bid, ask, c.volume, from_last))

    overround = None
    if buckets:
        range_points, overround = _range_to_survival(buckets)
        points.extend(range_points)

    points = _merge_duplicate_strikes(points)
    rules = next((c.rules for c in contracts if c.rules), "")
    return Ladder(asset, venue, resolution_at, points, dropped, rules, overround)


def _range_to_survival(buckets: list[tuple[Contract, float, bool]]) -> tuple[list[SurvivalPoint], float]:
    """Normalize bucket probs to sum to 1, then S(a_j) = sum of buckets at or above a_j."""
    total = sum(p for _, p, _ in buckets)
    if total <= 0:
        return [], total
    ordered = sorted(buckets, key=lambda b: float("-inf") if b[0].lo is None else b[0].lo)
    out: list[SurvivalPoint] = []
    tail = 0.0
    for c, p, from_last in reversed(ordered):
        tail += p / total
        if c.lo is None:
            continue
        out.append(SurvivalPoint(c.lo, min(tail, 1.0), _weight(c), [c.market_id],
                                 volume=c.volume, from_last=from_last))
    return out[::-1], total


def _merge_duplicate_strikes(points: list[SurvivalPoint]) -> list[SurvivalPoint]:
    by_strike: dict[float, list[SurvivalPoint]] = {}
    for p in points:
        by_strike.setdefault(p.strike, []).append(p)
    merged = []
    for k in sorted(by_strike):
        group = by_strike[k]
        if len(group) == 1:
            merged.append(group[0])
            continue
        w = sum(p.weight for p in group)
        prob = sum(p.prob * p.weight for p in group) / w
        merged.append(SurvivalPoint(k, prob, w, [m for p in group for m in p.market_ids],
                                    volume=sum(p.volume for p in group),
                                    from_last=any(p.from_last for p in group)))
    return merged
