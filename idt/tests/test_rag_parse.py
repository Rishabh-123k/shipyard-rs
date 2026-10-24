from datetime import datetime, timedelta, timezone

from idt.rag.parse import cited_ids, enforce, parse_question, unsupported_numbers

NOW = datetime(2026, 10, 24, 16, 30, tzinfo=timezone.utc)  # 12:30 ET


def test_asset_and_venue_detection():
    q = parse_question("Why did BTC's Kalshi median drop?", NOW)
    assert q.assets == ["BTC"] and q.venue == "kalshi"
    assert parse_question("what moved ether and bitcoin", NOW).assets == ["BTC", "ETH"]
    assert parse_question("what moved?", NOW).assets == ["BTC", "ETH"]


def test_this_morning_is_et_midnight_to_noon():
    q = parse_question("why did the median drop this morning", NOW)
    assert q.start == datetime(2026, 10, 24, 4, 0, tzinfo=timezone.utc)
    assert q.end == datetime(2026, 10, 24, 16, 0, tzinfo=timezone.utc)


def test_last_n_hours_and_default_window():
    q = parse_question("BTC in the last 6 hours", NOW)
    assert q.end - q.start == timedelta(hours=6) and q.window_label == "last 6 hours"
    assert parse_question("why", NOW).end - parse_question("why", NOW).start == timedelta(hours=24)


def test_yesterday():
    q = parse_question("what happened yesterday", NOW)
    assert q.start == datetime(2026, 10, 23, 4, 0, tzinfo=timezone.utc)
    assert q.end == datetime(2026, 10, 24, 4, 0, tzinfo=timezone.utc)


def test_numbers_must_appear_in_context():
    ctx = "[E1] median $79,818 -> $79,312; P(BTC above $79,550) 51.3% -> 44.6%"
    assert unsupported_numbers("The median fell to $79,312 [E1].", ctx) == []
    assert unsupported_numbers("It fell 6.7 points [E1].", ctx) == ["6.7"]
    assert unsupported_numbers("51.30% before [E1]", ctx) == []


def test_enforce_drops_bad_sentences_and_unknown_citations():
    ctx = "[E1] median $79,818 -> $79,312 [P1] @a: ETF outflows"
    answer = "The median fell to $79,312 [E1]. Outflows were cited [P1][P9]. It dropped 3% overall."
    out, warnings = enforce(answer, ctx, {"E1", "P1"})
    assert out == "The median fell to $79,312 [E1]. Outflows were cited [P1]."
    assert len(warnings) == 2


def test_bare_references_become_citations_only_for_known_ids():
    out, _ = enforce("Seen in E1 and P2, as P9 says.", "[E1] x [P2] y", {"E1", "P2"})
    assert out == "Seen in [E1] and [P2], as P9 says."


def test_cited_ids_in_order_without_duplicates():
    assert cited_ids("a [P2] b [E1] c [P2]") == ["P2", "E1"]
