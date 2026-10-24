from idt.model.sentiment import alignment, index, label_for


def s(overall, btc=None, eth=None):
    cats = [{"name": "overall", "sentiment": overall}]
    if btc:
        cats.append({"name": "Bitcoin price", "sentiment": btc})
    if eth:
        cats.append({"name": "Ethereum price", "sentiment": eth})
    return {"categories": cats}


def test_label_prefers_price_aspect_over_overall_tone():
    assert label_for(s("negative", btc="positive"), "BTC") == "positive"
    assert label_for(s("negative", eth="neutral"), "ETH") == "neutral"


def test_label_falls_back_to_overall_only_when_aspect_absent():
    assert label_for(s("negative"), "BTC") == "negative"
    assert label_for(s("negative", btc="unknown"), "BTC") is None
    assert label_for(None, "BTC") is None


def test_index_counts_and_score():
    idx = index(["positive", "negative", "negative", "neutral", None, "mixed"])
    assert idx == {"positive": 1, "negative": 2, "neutral": 1, "mixed": 1, "posts": 6, "scored": 5, "score": -0.2}


def test_index_of_nothing_has_no_score():
    assert index([None, None])["score"] is None


def test_alignment_states():
    neg = index(["negative"] * 4 + ["neutral"])
    assert alignment(neg, -0.12)["state"] == "aligned"
    assert alignment(neg, +0.12)["state"] == "divergent"
    assert alignment(neg, 0.002)["state"] == "market_flat"
    assert alignment(index(["positive", "negative", "neutral"]), -0.1)["state"] == "split"
    assert alignment(index(["negative", "negative"]), -0.1)["state"] == "insufficient"
