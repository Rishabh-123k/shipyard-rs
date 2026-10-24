"""Structured (SQL) + unstructured (vector) retrieval over the Snowflake corpus."""
from __future__ import annotations

from datetime import timedelta

from idt import config, sentiment_read
from idt.model.distribution import prob_above
from idt.model.sentiment import label_for
from idt.rag.parse import Query
from idt.store import snowflake as store

MAX_EVENTS = 6
MAX_POSTS = 8


def _in(values: list[str]) -> str:
    return ",".join(["%s"] * len(values))


def _median(quantiles: list[dict] | None) -> float | None:
    return next((x["value"] for x in quantiles or [] if abs(x["q"] - 0.5) < 1e-9), None)


def _p(curve: list[dict] | None, level: float) -> float | None:
    if not curve:
        return None
    p = prob_above([x["strike"] for x in curve], [x["fitted"] for x in curve], level)
    return None if p.clamped else p.prob


def events(q: Query) -> list[dict]:
    """Shift events in the window, most relevant to the question first, with before/after numbers."""
    venue_sql = "AND e.venue = %s" if q.venue else ""
    rows = store.query(
        f"""WITH qv AS (SELECT AI_EMBED(%s, %s) AS v)
            SELECT e.event_id, e.asset, e.venue, e.resolution_date, e.window_start, e.window_end, e.level,
                   e.d_median, e.d_p_above_spot, e.wasserstein, e.reasons, e.prev_snapshot_id, e.snapshot_id,
                   e.xsearch_status, s1.source,
                   s0.stats_json:quantiles AS prev_q, s1.stats_json:quantiles AS now_q,
                   s0.curve_json AS prev_curve, s1.curve_json AS now_curve,
                   VECTOR_COSINE_SIMILARITY(e.embedding, qv.v) AS sim
            FROM SHIFT_EVENTS e
            JOIN SNAPSHOTS s0 ON s0.snapshot_id = e.prev_snapshot_id
            JOIN SNAPSHOTS s1 ON s1.snapshot_id = e.snapshot_id, qv
            WHERE e.asset IN ({_in(q.assets)}) AND e.window_end BETWEEN %s AND %s {venue_sql}
            ORDER BY sim DESC NULLS LAST, ABS(e.d_p_above_spot) DESC NULLS LAST
            LIMIT {MAX_EVENTS}""",
        (config.EMBED_MODEL, q.text, *q.assets, q.start, q.end, *([q.venue] if q.venue else [])),
    )
    out = []
    for r in rows:
        level = r["level"]
        out.append({
            "event_id": r["event_id"], "asset": r["asset"], "venue": r["venue"],
            "resolution_at": r["resolution_date"].isoformat(),
            "window_start": r["window_start"].isoformat(), "window_end": r["window_end"].isoformat(),
            "prev_snapshot_id": r["prev_snapshot_id"], "snapshot_id": r["snapshot_id"], "source": r["source"],
            "level": level, "median_before": _median(r["prev_q"]), "median_after": _median(r["now_q"]),
            "p_before": _p(r["prev_curve"], level), "p_after": _p(r["now_curve"], level),
            "wasserstein": r["wasserstein"], "reasons": r["reasons"], "xsearch_status": r["xsearch_status"],
            "similarity": r["sim"],
        })
    sent = sentiment_read.by_event([{"event_id": e["event_id"], "asset": e["asset"],
                                     "d_p_above_spot": None if e["p_before"] is None or e["p_after"] is None
                                     else e["p_after"] - e["p_before"]} for e in out])
    for e in out:
        e["sentiment"] = sent[e["event_id"]]
    return sorted(out, key=lambda e: e["window_end"])


def posts(q: Query, event_ids: list[str]) -> list[dict]:
    """Top posts by cosine similarity, restricted to posts retrieved for this asset's shifts in the window."""
    lookback = timedelta(minutes=config.XSEARCH_LOOKBACK_MINUTES)
    scope = (f"ep.event_id IN ({_in(event_ids)})" if event_ids
             else f"e.asset IN ({_in(q.assets)}) AND e.window_end BETWEEN %s AND %s")
    scope_params = tuple(event_ids) if event_ids else (*q.assets, q.start, q.end)
    rows = store.query(
        f"""WITH qv AS (SELECT AI_EMBED(%s, %s) AS v),
            linked AS (
                SELECT ep.post_id, ARRAY_AGG(DISTINCT ep.query_mode) AS modes, BOOLOR_AGG(ep.in_window) AS in_window,
                       ARRAY_AGG(DISTINCT ep.event_id) AS event_ids
                FROM EVENT_POSTS ep JOIN SHIFT_EVENTS e ON e.event_id = ep.event_id
                WHERE {scope}
                GROUP BY ep.post_id)
            SELECT p.post_id, p.url, p.author, p.posted_at, p.text, p.text_source, l.modes, l.in_window, l.event_ids,
                   p.sentiment_json,
                   VECTOR_COSINE_SIMILARITY(p.embedding, qv.v) AS sim
            FROM POSTS p JOIN linked l ON l.post_id = p.post_id, qv
            WHERE p.embedding IS NOT NULL AND p.posted_at BETWEEN %s AND %s
            ORDER BY sim DESC
            LIMIT {MAX_POSTS}""",
        (config.EMBED_MODEL, q.text, *scope_params, q.start - lookback, q.end),
    )
    asset = q.assets[0] if len(q.assets) == 1 else None
    return [{k: v for k, v in {**r, "posted_at": r["posted_at"].isoformat(),
                               "sentiment": label_for(r["sentiment_json"], asset) if asset else None}.items()
             if k != "sentiment_json"}
            for r in rows if r["sim"] >= config.RAG_SIMILARITY_FLOOR]


def current_state(q: Query) -> list[dict]:
    """Latest live snapshot for the two nearest ladders per asset, for questions with no shift in range."""
    out = []
    for asset in q.assets:
        snaps = sorted(store.latest_snapshots(asset), key=lambda s: s["resolution_at"])
        if q.venue:
            snaps = [s for s in snaps if s["venue"] == q.venue]
        out += snaps[:2]
    return out
