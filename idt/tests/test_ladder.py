from datetime import datetime, timezone

import pytest

from idt.model.ladder import Contract, build_ladder

D = datetime(2026, 10, 30, 16, tzinfo=timezone.utc)


def above(mid_id, k, bid, ask, volume=100.0, last=None):
    return Contract("polymarket", mid_id, "BTC", D, "above", bid, ask, volume, last, strike=k)


def rng(mid_id, lo, hi, bid, ask):
    return Contract("kalshi", mid_id, "BTC", D, "range", bid, ask, 100.0, lo=lo, hi=hi)


def test_above_contracts_use_mid_and_spread_weight():
    lad = build_ladder([above("a", 80_000, 0.46, 0.49), above("b", 78_000, 0.67, 0.70)], max_spread=0.1)
    assert [p.strike for p in lad.points] == [78_000, 80_000]
    assert lad.points[1].prob == pytest.approx(0.475)
    assert lad.points[1].weight == pytest.approx(1 / 0.03)


def test_wide_spread_and_low_volume_are_dropped_with_reasons():
    lad = build_ladder(
        [above("ok", 80_000, 0.46, 0.49), above("wide", 82_000, 0.1, 0.4), above("thin", 84_000, 0.1, 0.12, volume=1)],
        max_spread=0.1, min_volume=10,
    )
    assert [p.strike for p in lad.points] == [80_000]
    reasons = {d.market_id: d.reason for d in lad.dropped}
    assert reasons["wide"].startswith("spread") and reasons["thin"].startswith("volume")


def test_missing_quote_needs_explicit_last_price_fallback():
    c = above("x", 80_000, None, None, last=0.5)
    assert build_ladder([c, above("y", 82_000, 0.2, 0.25)], max_spread=0.1).dropped[0].reason == "no two-sided quote"
    lad = build_ladder([c, above("y", 82_000, 0.2, 0.25)], max_spread=0.1, use_last=True)
    assert lad.points[0].from_last and lad.points[0].prob == 0.5


def test_below_contract_converts_to_survival():
    c = Contract("polymarket", "b", "BTC", D, "below", 0.30, 0.34, 100.0, strike=80_000)
    p = build_ladder([c, above("y", 82_000, 0.2, 0.25)], max_spread=0.1).points[0]
    assert p.prob == pytest.approx(0.68)
    assert p.bid == pytest.approx(0.66) and p.ask == pytest.approx(0.70)


def test_range_buckets_remove_overround_and_cumulate_from_top():
    # Mids sum to 1.10 (10% overround).
    cs = [rng("r0", None, 78_000, 0.19, 0.21), rng("r1", 78_000, 80_000, 0.39, 0.41),
          rng("r2", 80_000, 82_000, 0.34, 0.36), rng("r3", 82_000, None, 0.14, 0.16)]
    lad = build_ladder(cs, max_spread=0.1)
    assert lad.overround == pytest.approx(1.10)
    s = {p.strike: p.prob for p in lad.points}
    assert s[82_000] == pytest.approx(0.15 / 1.1)
    assert s[80_000] == pytest.approx(0.50 / 1.1)
    assert s[78_000] == pytest.approx(0.90 / 1.1)


def test_duplicate_strikes_merge_by_weight():
    lad = build_ladder([above("a", 80_000, 0.40, 0.42), above("b", 80_000, 0.50, 0.60)], max_spread=0.2)
    assert len(lad.points) == 1
    w1, w2 = 1 / 0.02, 1 / 0.10
    assert lad.points[0].prob == pytest.approx((0.41 * w1 + 0.55 * w2) / (w1 + w2))
    assert lad.points[0].market_ids == ["a", "b"]


def test_mixed_ladders_are_rejected():
    other = Contract("kalshi", "k", "BTC", D, "above", 0.4, 0.5, strike=1.0)
    with pytest.raises(ValueError):
        build_ladder([above("a", 1.0, 0.4, 0.5), other], max_spread=0.2)
