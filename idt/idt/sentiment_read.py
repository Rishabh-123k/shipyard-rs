"""Per-shift sentiment read model: index over in-window posts, per search mode, and crowd-vs-market alignment."""
from __future__ import annotations

from idt.model.sentiment import alignment, index, label_for
from idt.store import snowflake as store


def by_event(events: list[dict]) -> dict[str, dict]:
    """`events` need event_id, asset and d_p_above_spot. Only posts inside the shift window count."""
    rows = store.event_post_sentiment([e["event_id"] for e in events])
    asset = {e["event_id"]: e["asset"] for e in events}
    grouped: dict[str, dict[str, dict[str, str | None]]] = {}
    for r in rows:
        if not r["in_window"]:
            continue
        label = label_for(r["sentiment_json"], asset[r["event_id"]])
        modes = grouped.setdefault(r["event_id"], {"open": {}, "curated": {}})
        modes.setdefault(r["query_mode"], {})[r["post_id"]] = label
    out = {}
    for e in events:
        modes = grouped.get(e["event_id"], {"open": {}, "curated": {}})
        overall = index(list({**modes.get("open", {}), **modes.get("curated", {})}.values()))
        out[e["event_id"]] = {
            "overall": overall,
            "open": index(list(modes.get("open", {}).values())),
            "curated": index(list(modes.get("curated", {}).values())),
            "alignment": alignment(overall, e.get("d_p_above_spot")),
            "source": "Snowflake AI_SENTIMENT toward the asset's price, posts inside the shift window",
        }
    return out


def post_labels(posts: list[dict], asset: str) -> list[dict]:
    return [{**p, "sentiment": label_for(p.get("sentiment_json"), asset)} for p in posts]
