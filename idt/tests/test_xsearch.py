from datetime import datetime, timezone

from idt.sources.xsearch import parse_response, post_id_from_url, posted_at

A = "2113779411829010852"  # 2026-10-23 23:47:38.559 UTC
B = "2113530668646797473"  # 2026-10-23 07:19:13.563 UTC
W_FROM = datetime(2026, 10, 23, 23, 0, tzinfo=timezone.utc)
W_TO = datetime(2026, 10, 24, 0, 0, tzinfo=timezone.utc)


def test_post_id_and_time_decode():
    assert post_id_from_url(f"https://x.com/i/status/{A}") == (A, None)
    assert post_id_from_url(f"https://twitter.com/harry35979565/status/{A}?s=20") == (A, "harry35979565")
    assert post_id_from_url("https://x.com/home") is None
    assert posted_at(A) == datetime(2026, 10, 23, 23, 47, 38, 559000, tzinfo=timezone.utc)


def test_keeps_only_cited_posts_and_flags_window():
    content = (
        '```json\n{"summary": "ETF inflows.", "posts": ['
        f'{{"url": "https://x.com/harry/status/{A}", "author": "@harry", "text": "ETFs took in $1B"}}, '
        f'{{"url": "https://x.com/made_up/status/999999999999999999", "author": "fake", "text": "invented"}}'
        "]}\n```"
    )
    summary, posts = parse_response(content, [f"https://x.com/i/status/{A}", f"https://x.com/i/status/{B}"], W_FROM, W_TO)
    assert summary == "ETF inflows."
    ids = {p.post_id: p for p in posts}
    assert set(ids) == {A, B}
    assert ids[A].author == "harry" and ids[A].text == "ETFs took in $1B" and ids[A].in_window
    assert ids[B].text is None and ids[B].text_source == "citation_only" and not ids[B].in_window


def test_unparseable_content_becomes_summary_with_citation_only_posts():
    summary, posts = parse_response("No JSON here, just prose.", [f"https://x.com/i/status/{A}"], W_FROM, W_TO)
    assert summary == "No JSON here, just prose."
    assert [p.text_source for p in posts] == ["citation_only"]


def test_no_citations_means_no_posts_even_if_model_lists_some():
    content = f'{{"summary": "s", "posts": [{{"url": "https://x.com/a/status/{A}", "text": "t"}}]}}'
    assert parse_response(content, [], W_FROM, W_TO)[1] == []
