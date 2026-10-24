import math

import numpy as np
import pytest

from idt.model.distribution import fit, isotonic_decreasing, prob_above, quantile

K = [70_000, 72_000, 74_000, 76_000, 78_000, 80_000]


def test_isotonic_leaves_monotone_input_alone():
    y = [0.9, 0.7, 0.5, 0.2]
    assert isotonic_decreasing(y, [1] * 4) == y


def test_isotonic_pools_violation_to_weighted_mean():
    out = isotonic_decreasing([0.9, 0.4, 0.6, 0.1], [1, 1, 3, 1])
    assert out[1] == out[2] == pytest.approx((0.4 * 1 + 0.6 * 3) / 4)
    assert all(a >= b for a, b in zip(out, out[1:]))


def test_isotonic_clips_to_unit_interval():
    out = isotonic_decreasing([1.05, 0.5, -0.02], [1, 1, 1])
    assert out == [1.0, 0.5, 0.0]


def test_isotonic_rejects_bad_weights():
    with pytest.raises(ValueError):
        isotonic_decreasing([0.5, 0.4], [1, 0])


def test_isotonic_matches_bruteforce_on_random_input():
    rng = np.random.default_rng(0)
    for _ in range(50):
        y = rng.random(6).tolist()
        w = (rng.random(6) + 0.1).tolist()
        out = isotonic_decreasing(y, w)
        assert all(a >= b - 1e-12 for a, b in zip(out, out[1:]))
        loss = sum(wi * (a - b) ** 2 for wi, a, b in zip(w, y, out))
        # Any monotone perturbation of the fit must not reduce weighted squared error.
        for _ in range(20):
            cand = sorted((np.array(out) + rng.normal(0, 0.02, 6)).tolist(), reverse=True)
            assert loss <= sum(wi * (a - b) ** 2 for wi, a, b in zip(w, y, cand)) + 1e-12


def test_coherent_ladder_has_zero_correction():
    s = [0.95, 0.85, 0.6, 0.35, 0.15, 0.05]
    d = fit(K, s, [1] * 6)
    assert d.coherence_score == 0
    assert d.fitted == s


def test_non_monotone_ladder_is_corrected_and_scored():
    s = [0.95, 0.80, 0.85, 0.35, 0.15, 0.05]
    d = fit(K, s, [1] * 6)
    assert d.fitted[1] == d.fitted[2] == pytest.approx(0.825)
    assert d.coherence_score == pytest.approx(0.05)


def test_unsorted_input_is_sorted():
    s = [0.95, 0.85, 0.6, 0.35, 0.15, 0.05]
    d = fit(K[::-1], s[::-1], [1] * 6)
    assert d.strikes == K and d.fitted == s


def test_pmf_sums_to_one_with_tails():
    s = [0.95, 0.85, 0.6, 0.35, 0.15, 0.05]
    d = fit(K, s, [1] * 6)
    assert sum(b.mass for b in d.buckets) == pytest.approx(1.0)
    assert d.buckets[0].lo is None and d.buckets[0].mass == pytest.approx(0.05)
    assert d.buckets[-1].hi is None and d.buckets[-1].mass == pytest.approx(0.05)
    assert all(b.mass >= 0 for b in d.buckets)


def test_median_interpolates_linearly():
    s = [0.95, 0.85, 0.6, 0.4, 0.15, 0.05]
    q = quantile(K, s, 0.5)
    assert q.bound is None
    assert q.value == pytest.approx(75_000)


def test_quantile_in_open_tail_is_labeled_not_extrapolated():
    s = [0.85, 0.7, 0.6, 0.4, 0.3, 0.2]
    lo = quantile(K, s, 0.10)
    hi = quantile(K, s, 0.90)
    assert lo.value is None and lo.bound == "below 70,000"
    assert hi.value is None and hi.bound == "above 80,000"


def test_quantile_on_flat_cdf_segment_returns_left_strike():
    s = [0.9, 0.5, 0.5, 0.1]
    assert quantile(K[:4], s, 0.5).value == 72_000


def test_prob_above_interpolates_and_clamps():
    s = [0.95, 0.85, 0.6, 0.35, 0.15, 0.05]
    mid = prob_above(K, s, 73_000)
    assert mid.prob == pytest.approx(0.725) and mid.clamped is None
    below = prob_above(K, s, 60_000)
    assert below.prob == 0.95 and below.clamped.startswith("at least")
    above = prob_above(K, s, 90_000)
    assert above.prob == 0.05 and above.clamped.startswith("at most")


def test_implied_mean_of_symmetric_ladder_is_centre():
    s = [0.9, 0.8, 0.65, 0.35, 0.2, 0.1]
    d = fit(K, s, [1] * 6)
    assert d.mean == pytest.approx(75_000)
    assert "Tail mass placed at 69,000 and 81,000" in d.mean_assumption


def test_iqr():
    s = [0.95, 0.85, 0.75, 0.25, 0.15, 0.05]
    d = fit(K, s, [1] * 6)
    assert d.quantiles[1].value == pytest.approx(74_000)
    assert d.quantiles[3].value == pytest.approx(76_000)
    assert d.iqr == pytest.approx(2_000)
    assert d.iqr_over_median == pytest.approx(2_000 / 75_000)


def test_rejects_too_few_or_duplicate_strikes():
    with pytest.raises(ValueError):
        fit([1.0], [0.5], [1])
    with pytest.raises(ValueError):
        fit([1.0, 1.0], [0.5, 0.4], [1, 1])


def test_weights_pull_fit_toward_liquid_quote():
    d = fit([1, 2], [0.4, 0.6], [10, 1])
    assert d.fitted[0] == pytest.approx((0.4 * 10 + 0.6) / 11)
    assert not math.isnan(d.mean)
