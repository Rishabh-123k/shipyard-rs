"""Periodic snapshots -> Snowflake, shift detection, and x_search for shift windows."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from idt import config, engine
from idt.model.distribution import prob_above
from idt.model.shift import Thresholds, compare, reasons, strike_overlap
from idt.sources import xsearch
from idt.store import snowflake as store

log = logging.getLogger(__name__)

ASSETS = ("BTC", "ETH")
MIN_STRIKE_OVERLAP = 0.8
MODES = ("open", "curated")


def _key(d: dict) -> tuple[str, str, str]:
    return d["asset"], d["venue"], datetime.fromisoformat(d["resolution_at"]).isoformat()


def _median(d: dict) -> float | None:
    return next((q["value"] for q in d["quantiles"] if abs(q["q"] - 0.5) < 1e-9), None)


def _p_at(d: dict, level: float) -> float | None:
    p = prob_above([x["strike"] for x in d["points"]], [x["fitted"] for x in d["points"]], level)
    return None if p.clamped else p.prob


def event_text(asset: str, d_prev: dict, d_now: dict, t0: datetime, t1: datetime, level: float, why: list[str]) -> str:
    def money(v):
        return "n/a" if v is None else f"${v:,.0f}" if v >= 10_000 else f"${v:,.2f}"
    def pct(v):
        return "n/a" if v is None else f"{v:.1%}"
    return (
        f"{asset} {d_now['venue']} ladder resolving {d_now['resolution_at']} shifted between "
        f"{t0:%Y-%m-%d %H:%M} and {t1:%Y-%m-%d %H:%M} UTC: {'; '.join(why)}. "
        f"Median {money(_median(d_prev))} -> {money(_median(d_now))}. "
        f"P({asset} above {money(level)}) {pct(_p_at(d_prev, level))} -> {pct(_p_at(d_now, level))}."
    )


class Snapshotter:
    def __init__(self) -> None:
        self.prev: dict[tuple, tuple[str, dict, datetime]] = {}
        self.last_search: dict[str, datetime] = {}
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="xsearch")
        self.thresholds = Thresholds(config.SHIFT_REL_MEDIAN, config.SHIFT_P_ABOVE, config.SHIFT_REL_WASSERSTEIN)

    def warm(self) -> None:
        for asset in ASSETS:
            for s in store.latest_snapshots(asset):
                self.prev[_key(s)] = (s["snapshot_id"], s, datetime.fromisoformat(s["taken_at"]))
        log.info("warmed %d ladders from Snowflake", len(self.prev))

    def tick(self) -> dict:
        run_id = store.new_id()
        summary = {"run_id": run_id, "snapshots": 0, "events": 0}
        for asset in ASSETS:
            try:
                snap = engine.snapshot(asset)
            except Exception:  # noqa: BLE001 - one asset failing must not stop the other
                log.exception("snapshot failed for %s", asset)
                continue
            events = self.ingest(asset, snap["distributions"], snap["spot"],
                                 datetime.fromisoformat(snap["taken_at"]), run_id)
            summary["snapshots"] += len(snap["distributions"])
            summary["events"] += len(events)
        store.embed_pending()
        log.info("tick %s: %d snapshots, %d shift events", run_id, summary["snapshots"], summary["events"])
        return summary

    def refresh_asset(self, asset: str) -> list[dict]:
        snap = engine.snapshot(asset)
        events = self.ingest(asset, snap["distributions"], snap["spot"], datetime.fromisoformat(snap["taken_at"]),
                             store.new_id())
        store.embed_pending()
        return events

    def ingest(self, asset: str, dists: list[dict], spot: dict | None, taken_at: datetime, run_id: str,
               source: str = "live", search: bool = True) -> list[dict]:
        """Store snapshots, diff each against its ladder's previous one, record shift events."""
        events = []
        items = [(store.new_id(), d) for d in dists]
        store.insert_snapshots(run_id, items, spot, taken_at, source)
        for sid, d in items:
            key = _key(d)
            prior = self.prev.get(key)
            self.prev[key] = (sid, d, taken_at)
            if prior is None:
                continue
            hours_left = (datetime.fromisoformat(d["resolution_at"]) - taken_at) / timedelta(hours=1)
            if hours_left < config.SHIFT_MIN_HOURS_TO_RESOLUTION:
                continue
            level = spot["mid"] if spot else _median(d)
            if level is None:
                continue
            if strike_overlap(prior[1], d) < MIN_STRIKE_OVERLAP:
                log.info("skip shift check %s: strike sets changed too much", key)
                continue
            m = compare(prior[1], d, level)
            why = reasons(m, level, self.thresholds)
            if not why:
                continue
            events.append({
                "event_id": store.new_id(), "asset": asset, "venue": d["venue"],
                "resolution_at": d["resolution_at"], "window_start": prior[2].isoformat(),
                "window_end": taken_at.isoformat(), "prev_snapshot_id": prior[0], "snapshot_id": sid,
                "level": level, "d_median": m.d_median, "d_p_above_spot": m.d_p_above_spot,
                "wasserstein": m.wasserstein, "reasons": why,
                "summary_text": event_text(asset, prior[1], d, prior[2], taken_at, level, why),
                "score": max(
                    abs(m.d_median or 0) / level / self.thresholds.rel_median,
                    abs(m.d_p_above_spot or 0) / self.thresholds.p_above,
                    (m.wasserstein or 0) / level / self.thresholds.rel_wasserstein,
                ),
            })
        if events:
            self._record(asset, events, taken_at, search)
        return events

    def _record(self, asset: str, events: list[dict], now: datetime, search: bool = True) -> None:
        last = self.last_search.get(asset)
        cooling = last is not None and now - last < timedelta(minutes=config.XSEARCH_COOLDOWN_MINUTES)
        status = "not_searched" if not search else "cooldown" if cooling or not config.XAI_API_KEY else "queued"
        for e in events:
            store.insert_shift_event({**e, "xsearch_status": status})
        if status == "queued":
            self.last_search[asset] = now
            self.pool.submit(self.search_for, asset, events)

    def search_for(self, asset: str, events: list[dict]) -> None:
        ids = [e["event_id"] for e in events]
        start = min(datetime.fromisoformat(e["window_start"]) for e in events)
        end = max(datetime.fromisoformat(e["window_end"]) for e in events)
        why = sorted({f"{e['venue']}: {r}" for e in events for r in e["reasons"]})
        store.set_xsearch_status(ids, "running")
        ok = False
        for mode in MODES:
            res = xsearch.search(asset, start, end, mode, why, store.new_id())
            store.insert_xsearch_run(res.run_row())
            store.upsert_posts([p.to_row() for p in res.posts])
            store.link_event_posts([(eid, p.post_id, res.run_id, mode, p.in_window) for eid in ids for p in res.posts])
            ok = ok or res.error is None
            log.info("x_search %s %s: %d posts (%d in window)%s", asset, mode, len(res.posts),
                     sum(p.in_window for p in res.posts), f" error={res.error}" if res.error else "")
        store.set_xsearch_status(ids, "done" if ok else "error")
        store.embed_pending()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
