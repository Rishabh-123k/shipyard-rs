"""Coherent survival fit, PMF, quantiles and summary stats from a strike ladder."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from statistics import median

import numpy as np

QUANTILES = (0.10, 0.25, 0.50, 0.75, 0.90)


def isotonic_decreasing(y: list[float], w: list[float]) -> list[float]:
    """Weighted pool-adjacent-violators for a non-increasing fit, clipped to [0, 1]."""
    if len(y) != len(w):
        raise ValueError("y and w length mismatch")
    blocks: list[list[float]] = []  # [weighted mean, total weight, count]
    for yi, wi in zip(y, w):
        if wi <= 0:
            raise ValueError("weights must be positive")
        blocks.append([float(yi), float(wi), 1])
        while len(blocks) > 1 and blocks[-2][0] < blocks[-1][0]:
            m2, w2, n2 = blocks.pop()
            m1, w1, n1 = blocks.pop()
            wt = w1 + w2
            blocks.append([(m1 * w1 + m2 * w2) / wt, wt, n1 + n2])
    out: list[float] = []
    for m, _, n in blocks:
        out.extend([min(max(m, 0.0), 1.0)] * int(n))
    return out


@dataclass
class Quantile:
    q: float
    value: float | None
    bound: str | None  # "below K_min" / "above K_max" when the quantile sits in an open tail


@dataclass
class Bucket:
    lo: float | None
    hi: float | None
    mass: float


@dataclass
class ProbAbove:
    level: float
    prob: float
    clamped: str | None  # set when level is outside the strike grid; prob is then a bound


@dataclass
class Distribution:
    strikes: list[float]
    raw: list[float]
    fitted: list[float]
    coherence_score: float
    buckets: list[Bucket]
    quantiles: list[Quantile]
    mean: float
    mean_assumption: str
    iqr: float | None
    iqr_over_median: float | None

    def survival(self, level: float) -> ProbAbove:
        return prob_above(self.strikes, self.fitted, level)

    def to_dict(self) -> dict:
        return asdict(self)


def fit(strikes: list[float], probs: list[float], weights: list[float]) -> Distribution:
    if len(strikes) < 2:
        raise ValueError("need at least two strikes")
    order = np.argsort(strikes)
    k = [float(strikes[i]) for i in order]
    if len(set(k)) != len(k):
        raise ValueError("duplicate strikes; merge them first")
    raw = [float(probs[i]) for i in order]
    w = [float(weights[i]) for i in order]
    s = isotonic_decreasing(raw, w)
    coherence = float(sum(abs(a - b) for a, b in zip(raw, s)))

    buckets = pmf(k, s)
    qs = [quantile(k, s, q) for q in QUANTILES]
    mean, assumption = implied_mean(k, buckets)
    q25, q50, q75 = qs[1], qs[2], qs[3]
    iqr = None
    if q25.value is not None and q75.value is not None:
        iqr = q75.value - q25.value
    iqr_over_median = iqr / q50.value if iqr is not None and q50.value else None
    return Distribution(k, raw, s, coherence, buckets, qs, mean, assumption, iqr, iqr_over_median)


def pmf(strikes: list[float], survival: list[float]) -> list[Bucket]:
    out = [Bucket(None, strikes[0], 1.0 - survival[0])]
    for i in range(len(strikes) - 1):
        out.append(Bucket(strikes[i], strikes[i + 1], survival[i] - survival[i + 1]))
    out.append(Bucket(strikes[-1], None, survival[-1]))
    return out


def quantile(strikes: list[float], survival: list[float], q: float) -> Quantile:
    """Linear interpolation of the CDF F = 1 - S between strikes; no tail extrapolation."""
    cdf = [1.0 - s for s in survival]
    if q < cdf[0]:
        return Quantile(q, None, f"below {strikes[0]:,.0f}")
    if q > cdf[-1]:
        return Quantile(q, None, f"above {strikes[-1]:,.0f}")
    for i in range(len(strikes) - 1):
        f0, f1 = cdf[i], cdf[i + 1]
        if f0 <= q <= f1:
            if f1 == f0:
                return Quantile(q, strikes[i], None)
            t = (q - f0) / (f1 - f0)
            return Quantile(q, strikes[i] + t * (strikes[i + 1] - strikes[i]), None)
    return Quantile(q, strikes[-1], None)


def prob_above(strikes: list[float], survival: list[float], level: float) -> ProbAbove:
    if level <= strikes[0]:
        clamped = None if level == strikes[0] else f"at least {survival[0]:.3f} (level below lowest strike)"
        return ProbAbove(level, survival[0], clamped)
    if level >= strikes[-1]:
        clamped = None if level == strikes[-1] else f"at most {survival[-1]:.3f} (level above highest strike)"
        return ProbAbove(level, survival[-1], clamped)
    return ProbAbove(level, float(np.interp(level, strikes, survival)), None)


def implied_mean(strikes: list[float], buckets: list[Bucket]) -> tuple[float, str]:
    widths = [b.hi - b.lo for b in buckets if b.lo is not None and b.hi is not None]
    w = median(widths)
    total = 0.0
    for b in buckets:
        if b.lo is None:
            x = strikes[0] - w / 2
        elif b.hi is None:
            x = strikes[-1] + w / 2
        else:
            x = (b.lo + b.hi) / 2
        total += b.mass * x
    assumption = (f"Tail mass placed at {strikes[0] - w / 2:,.0f} and {strikes[-1] + w / 2:,.0f} "
                  f"(half the median bucket width, {w:,.0f}, beyond the outer strikes).")
    return total, assumption
