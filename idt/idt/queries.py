"""Read models for the Shifts page."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from idt import sentiment_read
from idt.rag.retrieve import _median, _p
from idt.model.sentiment import label_for
from idt.store import snowflake as store


def list_shifts(asset: str, hours: float) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = store.query(
        """SELECT e.event_id, e.asset, e.venue, e.resolution_date, e.window_start, e.window_end, e.level,
                  e.d_median, e.d_p_above_spot, e.wasserstein, e.reasons, e.xsearch_status, s1.source,
                  s0.stats_json:quantiles AS prev_q, s1.stats_json:quantiles AS now_q,
                  s0.curve_json AS prev_curve, s1.curve_json AS now_curve,
                  (SELECT COUNT(DISTINCT post_id) FROM EVENT_POSTS ep WHERE ep.event_id = e.event_id) AS n_posts
           FROM SHIFT_EVENTS e
           JOIN SNAPSHOTS s0 ON s0.snapshot_id = e.prev_snapshot_id
           JOIN SNAPSHOTS s1 ON s1.snapshot_id = e.snapshot_id
           WHERE e.asset = %s AND e.window_end >= %s
           ORDER BY e.window_end DESC""",
        (asset, since),
    )
    sent = sentiment_read.by_event(rows)
    return [{
        "sentiment": sent[r["event_id"]],
        "event_id": r["event_id"], "asset": r["asset"], "venue": r["venue"],
        "resolution_at": r["resolution_date"].isoformat(), "window_start": r["window_start"].isoformat(),
        "window_end": r["window_end"].isoformat(), "level": r["level"], "d_median": r["d_median"],
        "d_p_above_spot": r["d_p_above_spot"], "wasserstein": r["wasserstein"], "reasons": r["reasons"],
        "xsearch_status": r["xsearch_status"], "source": r["source"], "n_posts": r["n_posts"],
        "median_before": _median(r["prev_q"]), "median_after": _median(r["now_q"]),
        "p_before": _p(r["prev_curve"], r["level"]), "p_after": _p(r["now_curve"], r["level"]),
    } for r in rows]


def shift_detail(event_id: str) -> dict | None:
    rows = store.query("SELECT * EXCLUDE embedding FROM SHIFT_EVENTS WHERE event_id = %s", (event_id,))
    if not rows:
        return None
    e = rows[0]
    before = store.load_snapshot(e["prev_snapshot_id"])
    after = store.load_snapshot(e["snapshot_id"])
    links = store.query(
        """SELECT ep.query_mode, ep.in_window, ep.run_id, p.post_id, p.url, p.author, p.posted_at, p.text, p.text_source,
                  p.sentiment_json
           FROM EVENT_POSTS ep JOIN POSTS p ON p.post_id = ep.post_id
           WHERE ep.event_id = %s ORDER BY p.posted_at""",
        (event_id,),
    )
    run_ids = sorted({r["run_id"] for r in links})
    runs = store.query(
        f"""SELECT run_id, query_mode, model, grok_summary, search_from, search_to, handles, error,
                   ARRAY_SIZE(citations) AS n_citations
            FROM XSEARCH_RUNS WHERE run_id IN ({','.join(['%s'] * len(run_ids))})""",
        tuple(run_ids),
    ) if run_ids else []
    posts: dict[str, list[dict]] = {"open": [], "curated": []}
    for r in links:
        posts.setdefault(r["query_mode"], []).append({
            "post_id": r["post_id"], "url": r["url"], "author": r["author"], "posted_at": r["posted_at"].isoformat(),
            "text": r["text"], "text_source": r["text_source"], "in_window": r["in_window"],
            "sentiment": label_for(r["sentiment_json"], e["asset"]),
        })
    return {
        "event_id": e["event_id"], "asset": e["asset"], "venue": e["venue"],
        "resolution_at": e["resolution_date"].isoformat(), "window_start": e["window_start"].isoformat(),
        "window_end": e["window_end"].isoformat(), "level": e["level"], "reasons": e["reasons"],
        "d_median": e["d_median"], "d_p_above_spot": e["d_p_above_spot"], "wasserstein": e["wasserstein"],
        "xsearch_status": e["xsearch_status"], "summary_text": e["summary_text"],
        "sentiment": sentiment_read.by_event([{**e, "asset": e["asset"]}])[e["event_id"]],
        "before": before, "after": after, "posts": posts,
        "runs": [{**r, "search_from": r["search_from"].isoformat(), "search_to": r["search_to"].isoformat()} for r in runs],
    }
