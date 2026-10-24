"""Evidence shown beside a trade ticket, and the version a confirmation is bound to."""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone

from idt import config
from idt.model.distribution import prob_above
from idt.snapshots import Snapshotter
from idt.store import snowflake as store

log = logging.getLogger(__name__)

FRESH_FOR = timedelta(minutes=config.SNAPSHOT_INTERVAL_MINUTES + 1)

_lock = threading.Lock()
_refreshing: set[str] = set()
_snapshotter: Snapshotter | None = None


def _get_snapshotter() -> Snapshotter:
    global _snapshotter
    if _snapshotter is None:
        _snapshotter = Snapshotter()
        _snapshotter.warm()
    return _snapshotter


def _refresh(asset: str) -> None:
    try:
        with _lock:
            _get_snapshotter().refresh_asset(asset)
    except Exception:  # noqa: BLE001 - a failed refresh leaves the previous evidence in place
        log.exception("evidence refresh failed for %s", asset)
    finally:
        _refreshing.discard(asset)


def refresh_in_background(asset: str) -> bool:
    if asset in _refreshing:
        return False
    _refreshing.add(asset)
    threading.Thread(target=_refresh, args=(asset,), daemon=True, name=f"evidence-{asset}").start()
    return True


def version(asset: str) -> str | None:
    run = store.latest_live_run(asset)
    return run["run_id"] if run else None


def _median(quantiles: list[dict]) -> float | None:
    return next((q["value"] for q in quantiles if abs(q["q"] - 0.5) < 1e-9), None)


def _ladder(s: dict) -> dict:
    q = {round(x["q"], 2): x for x in s.get("quantiles") or []}
    return {
        "snapshot_id": s["snapshot_id"], "venue": s["venue"], "resolution_at": s["resolution_at"],
        "taken_at": s["taken_at"], "p_above_spot": s.get("p_above_spot"), "median": _median(s.get("quantiles") or []),
        "q10": q.get(0.1), "q90": q.get(0.9), "coherence_score": s["coherence_score"],
    }


def _latest_event(asset: str) -> dict | None:
    rows = store.query(
        """SELECT e.event_id, e.venue, e.resolution_date, e.window_start, e.window_end, e.level, e.reasons,
                  e.xsearch_status, s0.curve_json AS prev_curve, s1.curve_json AS now_curve, s1.source
           FROM SHIFT_EVENTS e
           JOIN SNAPSHOTS s0 ON s0.snapshot_id = e.prev_snapshot_id
           JOIN SNAPSHOTS s1 ON s1.snapshot_id = e.snapshot_id
           WHERE e.asset = %s AND e.window_end > DATEADD(hour, -24, CURRENT_TIMESTAMP())
           ORDER BY (e.xsearch_status = 'done') DESC, e.window_end DESC LIMIT 1""",
        (asset,),
    )
    if not rows:
        return None
    r = rows[0]

    def p(curve):
        x = prob_above([c["strike"] for c in curve], [c["fitted"] for c in curve], r["level"])
        return None if x.clamped else x.prob

    posts = store.query(
        """SELECT DISTINCT p.post_id, p.url, p.author, p.posted_at, p.text, ep.in_window
           FROM EVENT_POSTS ep JOIN POSTS p ON p.post_id = ep.post_id
           WHERE ep.event_id = %s AND p.text IS NOT NULL
           ORDER BY ep.in_window DESC, p.posted_at DESC LIMIT 4""",
        (r["event_id"],),
    )
    return {
        "event_id": r["event_id"], "venue": r["venue"], "resolution_at": r["resolution_date"].isoformat(),
        "window_start": r["window_start"].isoformat(), "window_end": r["window_end"].isoformat(),
        "level": r["level"], "reasons": r["reasons"], "source": r["source"], "xsearch_status": r["xsearch_status"],
        "p_before": p(r["prev_curve"]), "p_after": p(r["now_curve"]),
        "posts": [{**x, "posted_at": x["posted_at"].isoformat()} for x in posts],
    }


def evidence(asset: str) -> dict:
    run = store.latest_live_run(asset)
    now = datetime.now(timezone.utc)
    age = (now - datetime.fromisoformat(run["taken_at"])) if run else None
    refreshing = asset in _refreshing
    if run is None or age > FRESH_FOR:
        refreshing = refresh_in_background(asset) or refreshing
    ladders = [s for s in store.latest_snapshots(asset) if run and s["run_id"] == run["run_id"]]
    ladders.sort(key=lambda s: (s["resolution_at"], s["venue"]))
    return {
        "asset": asset,
        "version": run["run_id"] if run else None,
        "taken_at": run["taken_at"] if run else None,
        "age_seconds": age.total_seconds() if age else None,
        "fresh_for_seconds": FRESH_FOR.total_seconds(),
        "refreshing": refreshing,
        "ladders": [_ladder(s) for s in ladders],
        "event": _latest_event(asset),
    }


def thesis(row: dict) -> dict:
    """How the market's view at trade time compares with the latest snapshot of the same ladder."""
    trade_p = row.get("trade_p") or {}
    level = trade_p.get("level")
    latest_p = None
    if level is not None and row.get("latest_curve"):
        c = row["latest_curve"]
        x = prob_above([p["strike"] for p in c], [p["fitted"] for p in c], level)
        latest_p = None if x.clamped else x.prob
    resolved = row["resolution_date"] <= datetime.now(timezone.utc)
    return {
        "level": level, "p_at_trade": trade_p.get("prob"), "p_latest": latest_p,
        "latest_snapshot_id": row.get("latest_snapshot_id"),
        "latest_taken_at": row["latest_taken_at"].isoformat() if row.get("latest_taken_at") else None,
        "resolved": resolved,
    }
