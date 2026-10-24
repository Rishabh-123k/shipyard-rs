import pytest

from idt.model.shift import Thresholds, compare, reasons, strike_overlap, wasserstein1


def test_strike_overlap_is_jaccard():
    a = payload([70.0, 72.0, 74.0, 76.0], [0.9, 0.6, 0.3, 0.1], 73.0)
    b = payload([72.0, 74.0, 76.0, 78.0], [0.6, 0.3, 0.1, 0.0], 73.0)
    assert strike_overlap(a, b) == 3 / 5
    assert strike_overlap(a, a) == 1.0

K = [70.0, 72.0, 74.0, 76.0, 78.0]


def payload(strikes, survival, median):
    return {
        "points": [{"strike": k, "fitted": s} for k, s in zip(strikes, survival)],
        "quantiles": [{"q": 0.5, "value": median, "bound": None}],
    }


def test_identical_curves_have_zero_distance():
    s = [0.9, 0.7, 0.5, 0.3, 0.1]
    assert wasserstein1(K, s, K, s)[0] == 0


def test_parallel_shift_distance_is_area_between_curves():
    s1 = [0.9, 0.7, 0.5, 0.3, 0.1]
    s2 = [0.8, 0.6, 0.4, 0.2, 0.0]
    w, lo, hi = wasserstein1(K, s1, K, s2)
    assert (lo, hi) == (70, 78)
    assert w == pytest.approx(0.1 * 8)


def test_crossing_curves_split_at_the_root():
    w, _, _ = wasserstein1([0.0, 1.0], [1.0, 0.0], [0.0, 1.0], [0.0, 1.0])
    # |1-2x| on [0,1] integrates to 0.5.
    assert w == pytest.approx(0.5)


def test_distance_uses_only_the_shared_strike_range_and_union_grid():
    w, lo, hi = wasserstein1([70.0, 74.0, 78.0], [0.9, 0.5, 0.1], [72.0, 76.0, 80.0], [0.7, 0.3, 0.0])
    assert (lo, hi) == (72, 78)
    # Equal on [72, 76]; on [76, 78] curve 2 interpolates to 0.15 vs 0.10 at 78.
    assert w == pytest.approx(2 * 0.05 / 2)


def test_no_overlap_returns_none():
    assert wasserstein1([1.0, 2.0], [0.6, 0.4], [3.0, 4.0], [0.6, 0.4]) is None


def test_compare_holds_level_fixed_across_snapshots():
    prev = payload(K, [0.9, 0.7, 0.5, 0.3, 0.1], 74.0)
    now = payload(K, [0.8, 0.6, 0.4, 0.2, 0.0], 73.0)
    m = compare(prev, now, level=74.0)
    assert m.d_median == pytest.approx(-1.0)
    assert m.d_p_above_spot == pytest.approx(-0.1)
    assert m.wasserstein == pytest.approx(0.8)


def test_compare_skips_p_above_when_level_is_off_grid():
    prev = payload(K, [0.9, 0.7, 0.5, 0.3, 0.1], 74.0)
    assert compare(prev, prev, level=90.0).d_p_above_spot is None


def test_compare_skips_median_in_open_tail():
    prev = payload(K, [0.9, 0.7, 0.5, 0.3, 0.1], None)
    assert compare(prev, prev, level=74.0).d_median is None


def test_reasons_apply_relative_thresholds():
    prev = payload(K, [0.9, 0.7, 0.5, 0.3, 0.1], 74.0)
    now = payload(K, [0.8, 0.6, 0.4, 0.2, 0.0], 73.0)
    m = compare(prev, now, level=74.0)
    t = Thresholds(rel_median=0.01, p_above=0.05, rel_wasserstein=0.005)
    r = reasons(m, price=74.0, t=t)
    assert len(r) == 3 and r[0].startswith("median moved -1.00")
    assert reasons(m, price=74.0, t=Thresholds(0.5, 0.5, 0.5)) == []
