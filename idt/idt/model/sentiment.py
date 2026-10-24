"""Roll per-post sentiment (Snowflake AI_SENTIMENT) into an index and compare it with what the market priced."""
from __future__ import annotations

ASPECTS = {"BTC": "Bitcoin price", "ETH": "Ethereum price"}
SCORE = {"positive": 1, "negative": -1, "neutral": 0, "mixed": 0}
MIN_SCORED = 3
FLAT_BAND = 0.2
FLAT_MARKET_PP = 0.01


def label_for(sentiment: dict | None, asset: str) -> str | None:
    """Sentiment toward the asset's price; falls back to overall tone only if the aspect is absent."""
    if not sentiment:
        return None
    cats = {c.get("name"): c.get("sentiment") for c in sentiment.get("categories") or []}
    label = cats.get(ASPECTS.get(asset, ""))
    if label is None:
        label = cats.get("overall")
    return label if label in SCORE else None


def index(labels: list[str | None]) -> dict:
    counts = {k: 0 for k in SCORE}
    for label in labels:
        if label in counts:
            counts[label] += 1
    scored = sum(counts.values())
    score = (counts["positive"] - counts["negative"]) / scored if scored else None
    return {**counts, "posts": len(labels), "scored": scored, "score": score}


def alignment(idx: dict, d_p_above: float | None) -> dict:
    """Do the posts lean the same way the market moved P(above spot)? Descriptive, not a trade signal."""
    score = idx.get("score")
    if idx.get("scored", 0) < MIN_SCORED or score is None:
        return {"state": "insufficient", "text": f"Too few scored posts (under {MIN_SCORED}) to read a lean."}
    if abs(score) < FLAT_BAND:
        return {"state": "split", "text": "Posts are split; no clear lean toward the price."}
    lean = "positive" if score > 0 else "negative"
    if d_p_above is None or abs(d_p_above) < FLAT_MARKET_PP:
        return {"state": "market_flat", "text": f"Posts lean {lean}, but the market barely moved P(above spot)."}
    market = "raised" if d_p_above > 0 else "cut"
    if (score > 0) == (d_p_above > 0):
        return {"state": "aligned", "text": f"Posts lean {lean} and the market {market} P(above spot): crowd and prices agree."}
    return {"state": "divergent",
            "text": f"Posts lean {lean} but the market {market} P(above spot): crowd and prices disagree."}
