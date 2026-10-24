import json
from datetime import datetime, timezone
from pathlib import Path

from idt.model.distribution import fit
from idt.model.ladder import build_ladder
from idt.sources import kalshi, polymarket

FX = Path(__file__).resolve().parent.parent / "fixtures"
NOW = datetime(2026, 10, 24, 16, 30, tzinfo=timezone.utc)


def load(name):
    return json.loads((FX / name).read_text())


def test_polymarket_oct30_ladder_parses_all_strikes():
    ev = load("polymarket_event_btc_oct30.json")
    contracts, rejected = polymarket.parse_event(ev, "BTC", NOW)
    assert not rejected
    assert sorted(c.strike for c in contracts) == [72_000 + 2_000 * i for i in range(11)]
    assert all(c.resolution_at == datetime(2026, 10, 30, 16, tzinfo=timezone.utc) for c in contracts)
    assert "Binance" in contracts[0].rules


def test_polymarket_rejects_wrong_asset_and_touch_markets():
    ev = load("polymarket_event_btc_oct30.json")
    assert polymarket.parse_event(ev, "ETH", NOW)[0] == []
    touch = {**ev, "title": "What price will Bitcoin hit on October 30?"}
    assert polymarket.parse_event(touch, "BTC", NOW)[1][0]["reason"] == "event title not a price ladder"


def test_polymarket_rejects_resolved_event_and_bad_question():
    ev = load("polymarket_event_btc_oct30.json")
    assert polymarket.parse_event(ev, "BTC", datetime(2026, 11, 1, tzinfo=timezone.utc))[0] == []
    bad = {**ev, "markets": [{**ev["markets"][0], "question": "Will the price of Bitcoin be above $80k soon?"}]}
    assert polymarket.parse_event(bad, "BTC", NOW)[1][0]["reason"] == "question did not match strict regex"


def test_polymarket_missing_book_side_maps_to_empty():
    ev = load("polymarket_event_btc_oct30.json")
    mk = {k: v for k, v in ev["markets"][0].items() if k != "bestBid"}
    c, _ = polymarket.parse_event({**ev, "markets": [mk]}, "BTC", NOW)
    assert c[0].bid == 0.0


def test_kalshi_above_series_groups_into_fittable_ladder():
    ms = load("kalshi_markets_KXBTCD.json")["markets"]
    contracts, _ = kalshi.parse_markets(ms, "BTC", False, NOW)
    oct30 = [c for c in contracts if c.resolution_at == datetime(2026, 10, 30, 21, tzinfo=timezone.utc)]
    assert len(oct30) == 50 and all(c.kind == "above" for c in oct30)
    lad = build_ladder(oct30, max_spread=0.10)
    d = fit([p.strike for p in lad.points], [p.prob for p in lad.points], [p.weight for p in lad.points])
    assert all(a >= b for a, b in zip(d.fitted, d.fitted[1:]))
    assert d.quantiles[2].value is not None


def test_kalshi_range_series_tails_become_open_buckets():
    ms = load("kalshi_markets_KXBTC.json")["markets"]
    contracts, rejected = kalshi.parse_markets(ms, "BTC", True, NOW)
    assert not [r for r in rejected if "unsupported" in r["reason"]]
    kinds = {(c.lo is None, c.hi is None) for c in contracts}
    assert (True, False) in kinds and (False, True) in kinds
