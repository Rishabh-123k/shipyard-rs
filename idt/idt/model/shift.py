"""Compare consecutive fitted curves for one (asset, date, venue) and flag material shifts."""
from __future__ import annotations

from dataclasses import asdict, dataclass

from idt.model.distribution import prob_above


@dataclass
class ShiftMetrics:
    d_median: float | None
    d_p_above_spot: float | None
    wasserstein: float | None
    level: float
    overlap_lo: float | None
    overlap_hi: float | None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Thresholds:
    rel_median: float
    p_above: float
    rel_wasserstein: float


def _interp(k: list[float], s: list[float], x: float) -> float:
    for i in range(len(k) - 1):
        if k[i] <= x <= k[i + 1]:
            if k[i + 1] == k[i]:
                return s[i]
            t = (x - k[i]) / (k[i + 1] - k[i])
            return s[i] + t * (s[i + 1] - s[i])
    raise ValueError(f"{x} outside [{k[0]}, {k[-1]}]")


def _abs_integral(x0: float, d0: float, x1: float, d1: float) -> float:
    """Exact integral of |d| where d is linear from d0 at x0 to d1 at x1."""
    w = x1 - x0
    if d0 * d1 >= 0:
        return w * (abs(d0) + abs(d1)) / 2
    root = w * abs(d0) / (abs(d0) + abs(d1))
    return (root * abs(d0) + (w - root) * abs(d1)) / 2


def wasserstein1(k1: list[float], s1: list[float], k2: list[float], s2: list[float]) -> tuple[float, float, float] | None:
    """W1 = ∫|F1 - F2| dx = ∫|S1 - S2| dx over the strike range both curves cover. None if no overlap."""
    lo, hi = max(k1[0], k2[0]), min(k1[-1], k2[-1])
    if hi <= lo:
        return None
    grid = sorted({lo, hi, *(k for k in k1 if lo < k < hi), *(k for k in k2 if lo < k < hi)})
    diffs = [_interp(k1, s1, x) - _interp(k2, s2, x) for x in grid]
    total = sum(_abs_integral(grid[i], diffs[i], grid[i + 1], diffs[i + 1]) for i in range(len(grid) - 1))
    return total, lo, hi


def strike_overlap(prev: dict, now: dict) -> float:
    """Jaccard overlap of the two strike sets. Low overlap means the curves aren't comparable."""
    a = {p["strike"] for p in prev["points"]}
    b = {p["strike"] for p in now["points"]}
    return len(a & b) / len(a | b) if a | b else 0.0


def _median(d: dict) -> float | None:
    q = next((q for q in d["quantiles"] if abs(q["q"] - 0.5) < 1e-9), None)
    return q["value"] if q else None


def compare(prev: dict, now: dict, level: float) -> ShiftMetrics:
    """`prev`/`now` are engine.describe() payloads. `level` is the current spot, used for both curves."""
    k1 = [p["strike"] for p in prev["points"]]
    s1 = [p["fitted"] for p in prev["points"]]
    k2 = [p["strike"] for p in now["points"]]
    s2 = [p["fitted"] for p in now["points"]]

    m_prev, m_now = _median(prev), _median(now)
    d_median = m_now - m_prev if m_prev is not None and m_now is not None else None

    a, b = prob_above(k1, s1, level), prob_above(k2, s2, level)
    d_p = b.prob - a.prob if a.clamped is None and b.clamped is None else None

    w = wasserstein1(k1, s1, k2, s2)
    return ShiftMetrics(d_median, d_p, w[0] if w else None, level, w[1] if w else None, w[2] if w else None)


def reasons(m: ShiftMetrics, price: float, t: Thresholds) -> list[str]:
    out = []
    if m.d_median is not None and abs(m.d_median) / price >= t.rel_median:
        out.append(f"median moved {m.d_median:+,.2f} ({m.d_median / price:+.2%})")
    if m.d_p_above_spot is not None and abs(m.d_p_above_spot) >= t.p_above:
        out.append(f"P(above spot) moved {m.d_p_above_spot * 100:+.1f} pp")
    if m.wasserstein is not None and m.wasserstein / price >= t.rel_wasserstein:
        out.append(f"curve moved W1 {m.wasserstein:,.2f} ({m.wasserstein / price:.2%} of price)")
    return out
