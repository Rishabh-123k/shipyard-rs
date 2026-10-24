"""Snowflake persistence: snapshots, contracts, shift events, X search runs, posts, trades."""
from __future__ import annotations

import json
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator

import snowflake.connector
from snowflake.connector import DictCursor

from idt import config

DDL = [
    f"""CREATE TABLE IF NOT EXISTS SNAPSHOTS (
        snapshot_id STRING PRIMARY KEY, run_id STRING, asset STRING, resolution_date TIMESTAMP_TZ,
        venue STRING, taken_at TIMESTAMP_TZ, spot_price FLOAT, spot_json VARIANT, curve_json VARIANT,
        stats_json VARIANT, coherence_score FLOAT, dropped_json VARIANT, rules STRING,
        summary_text STRING, embedding VECTOR(FLOAT, {config.EMBED_DIM}), source STRING)""",
    """CREATE TABLE IF NOT EXISTS CONTRACTS (
        snapshot_id STRING, venue STRING, market_id STRING, strike FLOAT, raw_bid FLOAT, raw_ask FLOAT,
        raw_mid FLOAT, fitted_prob FLOAT, volume FLOAT)""",
    f"""CREATE TABLE IF NOT EXISTS SHIFT_EVENTS (
        event_id STRING PRIMARY KEY, asset STRING, resolution_date TIMESTAMP_TZ, venue STRING,
        window_start TIMESTAMP_TZ, window_end TIMESTAMP_TZ, prev_snapshot_id STRING, snapshot_id STRING,
        level FLOAT, d_median FLOAT, d_p_above_spot FLOAT, wasserstein FLOAT, reasons VARIANT,
        summary_text STRING, embedding VECTOR(FLOAT, {config.EMBED_DIM}), xsearch_status STRING)""",
    """CREATE TABLE IF NOT EXISTS XSEARCH_RUNS (
        run_id STRING PRIMARY KEY, asset STRING, window_start TIMESTAMP_TZ, window_end TIMESTAMP_TZ,
        search_from TIMESTAMP_TZ, search_to TIMESTAMP_TZ, query_mode STRING, handles VARIANT, model STRING,
        grok_summary STRING, citations VARIANT, raw_content STRING, error STRING, created_at TIMESTAMP_TZ)""",
    f"""CREATE TABLE IF NOT EXISTS POSTS (
        post_id STRING PRIMARY KEY, url STRING, author STRING, posted_at TIMESTAMP_TZ, text STRING,
        text_source STRING, embedding VECTOR(FLOAT, {config.EMBED_DIM}))""",
    """CREATE TABLE IF NOT EXISTS EVENT_POSTS (
        event_id STRING, post_id STRING, run_id STRING, query_mode STRING, in_window BOOLEAN)""",
    """CREATE TABLE IF NOT EXISTS TRADES (
        trade_id STRING PRIMARY KEY, created_at TIMESTAMP_TZ, asset STRING, side STRING, usd_amount FLOAT,
        quote_json VARIANT, order_id STRING, status STRING, dry_run BOOLEAN, rationale STRING,
        snapshot_id STRING, event_id STRING, cited_post_ids VARIANT)""",
]

# One connection per thread: a slow background statement (AI_EMBED / AI_SENTIMENT backfills) must not
# block request threads, which a single shared, locked connection did.
_local = threading.local()


def new_id() -> str:
    return uuid.uuid4().hex


def connect():
    conn = getattr(_local, "conn", None)
    if conn is None or conn.is_closed():
        params = {k: v for k, v in config.SNOWFLAKE.items() if v}
        conn = snowflake.connector.connect(**params, client_session_keep_alive=True)
        _local.conn = conn
    return conn


@contextmanager
def cursor(dict_rows: bool = False) -> Iterator[Any]:
    cur = connect().cursor(DictCursor) if dict_rows else connect().cursor()
    try:
        yield cur
    finally:
        cur.close()


def query(sql: str, params: Any = None) -> list[dict]:
    with cursor(dict_rows=True) as cur:
        rows = cur.execute(sql, params).fetchall()
    return [{k.lower(): _decode(v) for k, v in r.items()} for r in rows]


def _decode(v: Any) -> Any:
    if isinstance(v, str) and v[:1] in "[{":
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v


def ensure_schema() -> None:
    with cursor() as cur:
        for stmt in DDL:
            cur.execute(stmt)
        cur.execute("ALTER TABLE SNAPSHOTS ADD COLUMN IF NOT EXISTS source STRING")
        cur.execute("ALTER TABLE POSTS ADD COLUMN IF NOT EXISTS sentiment_json VARIANT")
        for col in ("customer_id STRING", "evidence_json VARIANT", "updated_at TIMESTAMP_TZ", "error STRING"):
            cur.execute(f"ALTER TABLE TRADES ADD COLUMN IF NOT EXISTS {col}")


def snapshot_text(d: dict, taken_at: datetime) -> str:
    """Short text rendering of a snapshot's stats, embedded for retrieval."""
    def money(v):
        return "n/a" if v is None else f"${v:,.0f}" if v >= 10_000 else f"${v:,.2f}"
    q = {round(x["q"], 2): (money(x["value"]) if x["value"] is not None else x["bound"]) for x in d["quantiles"]}
    p = d.get("p_above_spot")
    parts = [
        f"{d['asset']} {d['venue']} price ladder resolving {d['resolution_at']}, snapshot taken {taken_at.isoformat()}.",
        f"True Markets spot {money(d.get('spot_mid'))}.",
    ]
    if p:
        parts.append(f"Market-implied probability {d['asset']} finishes above spot: {p['prob']:.1%}.")
    parts.append(f"Median {q.get(0.5)}, 10th percentile {q.get(0.1)}, 90th percentile {q.get(0.9)}, "
                 f"interquartile range {money(d['iqr'])}, implied mean {money(d['mean'])}.")
    parts.append(f"Coherence correction {d['coherence_score']:.4f}.")
    return " ".join(parts)


STAT_KEYS = ("quantiles", "buckets", "mean", "mean_assumption", "iqr", "iqr_over_median", "p_above_spot", "overround")


def insert_snapshots(run_id: str, items: list[tuple[str, dict]], spot: dict | None, taken_at: datetime,
                     source: str = "live") -> None:
    """Insert (snapshot_id, payload) pairs for one tick in two statements."""
    if not items:
        return
    spot_json = json.dumps({k: v for k, v in (spot or {}).items() if k != "quotes"})
    rows, params = [], []
    for sid, d in items:
        rows.append("(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)")
        params += [sid, run_id, d["asset"], d["resolution_at"], d["venue"], taken_at.isoformat(),
                   spot["mid"] if spot else None, spot_json, json.dumps(d["points"]),
                   json.dumps({k: d[k] for k in STAT_KEYS}), d["coherence_score"], json.dumps(d["dropped"]),
                   d["rules"], snapshot_text({**d, "spot_mid": spot["mid"] if spot else None}, taken_at), source]
    with cursor() as cur:
        cur.execute(
            f"""INSERT INTO SNAPSHOTS (snapshot_id, run_id, asset, resolution_date, venue, taken_at, spot_price,
                    spot_json, curve_json, stats_json, coherence_score, dropped_json, rules, summary_text, source)
                SELECT column1, column2, column3, column4::TIMESTAMP_TZ, column5, column6::TIMESTAMP_TZ, column7,
                    PARSE_JSON(column8), PARSE_JSON(column9), PARSE_JSON(column10), column11, PARSE_JSON(column12),
                    column13, column14, column15
                FROM VALUES {', '.join(rows)}""",
            params,
        )
        cur.executemany(
            """INSERT INTO CONTRACTS (snapshot_id, venue, market_id, strike, raw_bid, raw_ask, raw_mid,
                   fitted_prob, volume) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [(sid, d["venue"], ",".join(p["market_ids"]), p["strike"], p["bid"], p["ask"], p["raw"], p["fitted"],
              p["volume"]) for sid, d in items for p in d["points"]],
        )


def latest_live_run(asset: str) -> dict | None:
    rows = query("""SELECT run_id, MAX(taken_at) AS taken_at FROM SNAPSHOTS
                    WHERE asset = %s AND COALESCE(source, 'live') = 'live'
                    GROUP BY run_id ORDER BY taken_at DESC LIMIT 1""", (asset,))
    return {"run_id": rows[0]["run_id"], "taken_at": rows[0]["taken_at"].isoformat()} if rows else None


def load_snapshot(snapshot_id: str) -> dict | None:
    rows = query("SELECT * FROM SNAPSHOTS WHERE snapshot_id = %s", (snapshot_id,))
    return _snapshot_payload(rows[0]) if rows else None


def latest_snapshots(asset: str) -> list[dict]:
    rows = query(
        """SELECT * EXCLUDE embedding FROM SNAPSHOTS WHERE asset = %s AND COALESCE(source, 'live') = 'live'
             AND resolution_date > CURRENT_TIMESTAMP()
           QUALIFY ROW_NUMBER() OVER (PARTITION BY venue, resolution_date ORDER BY taken_at DESC) = 1""",
        (asset,),
    )
    return [_snapshot_payload(r) for r in rows]


def _snapshot_payload(r: dict) -> dict:
    stats = r["stats_json"] or {}
    return {
        "snapshot_id": r["snapshot_id"], "run_id": r.get("run_id"), "asset": r["asset"], "venue": r["venue"],
        "resolution_at": r["resolution_date"].isoformat(), "taken_at": r["taken_at"].isoformat(),
        "spot": r["spot_json"], "points": r["curve_json"], "coherence_score": r["coherence_score"],
        "dropped": r["dropped_json"], "rules": r.get("rules"), "source": r.get("source") or "live", **stats,
    }


def insert_shift_event(e: dict) -> None:
    with cursor() as cur:
        cur.execute(
            """INSERT INTO SHIFT_EVENTS (event_id, asset, resolution_date, venue, window_start, window_end,
                   prev_snapshot_id, snapshot_id, level, d_median, d_p_above_spot, wasserstein, reasons,
                   summary_text, xsearch_status)
               SELECT %s, %s, %s::TIMESTAMP_TZ, %s, %s::TIMESTAMP_TZ, %s::TIMESTAMP_TZ, %s, %s, %s, %s, %s, %s,
                   PARSE_JSON(%s), %s, %s""",
            (e["event_id"], e["asset"], e["resolution_at"], e["venue"], e["window_start"], e["window_end"],
             e["prev_snapshot_id"], e["snapshot_id"], e["level"], e["d_median"], e["d_p_above_spot"],
             e["wasserstein"], json.dumps(e["reasons"]), e["summary_text"], e["xsearch_status"]),
        )


def set_xsearch_status(event_ids: list[str], status: str) -> None:
    if not event_ids:
        return
    with cursor() as cur:
        cur.execute(f"UPDATE SHIFT_EVENTS SET xsearch_status = %s WHERE event_id IN ({','.join(['%s'] * len(event_ids))})",
                    (status, *event_ids))


def insert_xsearch_run(run: dict) -> None:
    with cursor() as cur:
        cur.execute(
            """INSERT INTO XSEARCH_RUNS (run_id, asset, window_start, window_end, search_from, search_to, query_mode,
                   handles, model, grok_summary, citations, raw_content, error, created_at)
               SELECT %s, %s, %s::TIMESTAMP_TZ, %s::TIMESTAMP_TZ, %s::TIMESTAMP_TZ, %s::TIMESTAMP_TZ, %s,
                   PARSE_JSON(%s), %s, %s, PARSE_JSON(%s), %s, %s, CURRENT_TIMESTAMP()""",
            (run["run_id"], run["asset"], run["window_start"], run["window_end"], run["search_from"],
             run["search_to"], run["query_mode"], json.dumps(run.get("handles")), run["model"],
             run.get("grok_summary"), json.dumps(run.get("citations", [])), run.get("raw_content"),
             run.get("error")),
        )


def upsert_posts(posts: list[dict]) -> None:
    if not posts:
        return
    with cursor() as cur:
        for p in posts:
            cur.execute(
                """MERGE INTO POSTS t USING (SELECT %s AS post_id, %s AS url, %s AS author,
                       %s::TIMESTAMP_TZ AS posted_at, %s AS text, %s AS text_source) s
                   ON t.post_id = s.post_id
                   WHEN NOT MATCHED THEN INSERT (post_id, url, author, posted_at, text, text_source)
                       VALUES (s.post_id, s.url, s.author, s.posted_at, s.text, s.text_source)""",
                (p["post_id"], p["url"], p.get("author"), p["posted_at"], p.get("text"), p["text_source"]),
            )


def link_event_posts(rows: list[tuple[str, str, str, str, bool]]) -> None:
    if not rows:
        return
    with cursor() as cur:
        cur.executemany(
            "INSERT INTO EVENT_POSTS (event_id, post_id, run_id, query_mode, in_window) VALUES (%s, %s, %s, %s, %s)",
            rows,
        )


def delete_backfill() -> None:
    """Remove rows a previous backfill created. Live snapshots and fetched posts are kept."""
    backfill = "SELECT snapshot_id FROM SNAPSHOTS WHERE source = 'backfill'"
    with cursor() as cur:
        cur.execute(f"DELETE FROM EVENT_POSTS WHERE event_id IN (SELECT event_id FROM SHIFT_EVENTS WHERE snapshot_id IN ({backfill}))")
        cur.execute(f"DELETE FROM SHIFT_EVENTS WHERE snapshot_id IN ({backfill})")
        cur.execute(f"DELETE FROM CONTRACTS WHERE snapshot_id IN ({backfill})")
        cur.execute("DELETE FROM SNAPSHOTS WHERE source = 'backfill'")


def event_post_sentiment(event_ids: list[str]) -> list[dict]:
    if not event_ids:
        return []
    return query(
        f"""SELECT ep.event_id, ep.query_mode, ep.in_window, p.post_id, p.sentiment_json
            FROM EVENT_POSTS ep JOIN POSTS p ON p.post_id = ep.post_id
            WHERE ep.event_id IN ({','.join(['%s'] * len(event_ids))}) AND p.text IS NOT NULL""",
        tuple(event_ids),
    )


def embed_pending() -> None:
    """Embed every row that has text but no vector, in-database via AI_EMBED."""
    m = config.EMBED_MODEL
    with cursor() as cur:
        cur.execute("UPDATE SNAPSHOTS SET embedding = AI_EMBED(%s, summary_text) "
                    "WHERE embedding IS NULL AND summary_text IS NOT NULL", (m,))
        cur.execute("UPDATE SHIFT_EVENTS SET embedding = AI_EMBED(%s, summary_text) "
                    "WHERE embedding IS NULL AND summary_text IS NOT NULL", (m,))
        cur.execute("UPDATE POSTS SET embedding = AI_EMBED(%s, COALESCE(author, '') || ': ' || text) "
                    "WHERE embedding IS NULL AND text IS NOT NULL", (m,))
        # Sentiment toward each tradeable asset's price, computed in-database (Snowflake AI_SENTIMENT).
        cur.execute("UPDATE POSTS SET sentiment_json = AI_SENTIMENT(text, ['Bitcoin price', 'Ethereum price']) "
                    "WHERE sentiment_json IS NULL AND text IS NOT NULL")


LIVE_TRADE_STATUSES_EXCLUDED = ("failed", "canceled", "rejected")


def insert_trade(t: dict) -> None:
    with cursor() as cur:
        cur.execute(
            """INSERT INTO TRADES (trade_id, created_at, updated_at, customer_id, asset, side, usd_amount, quote_json,
                   order_id, status, dry_run, rationale, snapshot_id, event_id, cited_post_ids, evidence_json)
               SELECT %s, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), %s, %s, %s, %s, PARSE_JSON(%s), %s, %s, %s, %s,
                   %s, %s, PARSE_JSON(%s), PARSE_JSON(%s)""",
            (t["trade_id"], t["customer_id"], t["asset"], t["side"], t["usd_amount"], json.dumps(t.get("quote")),
             t.get("order_id"), t["status"], t["dry_run"], t.get("rationale"), t["snapshot_id"], t.get("event_id"),
             json.dumps(t.get("cited_post_ids", [])), json.dumps(t.get("evidence"))),
        )


def update_trade(trade_id: str, status: str, order_id: str | None = None, error: str | None = None) -> None:
    with cursor() as cur:
        cur.execute(
            """UPDATE TRADES SET status = %s, order_id = COALESCE(%s, order_id), error = COALESCE(%s, error),
                   updated_at = CURRENT_TIMESTAMP() WHERE trade_id = %s""",
            (status, order_id, error, trade_id),
        )


def live_trades_total_usd() -> float:
    """USD committed by real (non-dry-run) trades that didn't fail, for the cumulative cap."""
    placeholders = ",".join(["%s"] * len(LIVE_TRADE_STATUSES_EXCLUDED))
    rows = query(f"SELECT COALESCE(SUM(usd_amount), 0) AS total FROM TRADES "
                 f"WHERE dry_run = FALSE AND status NOT IN ({placeholders})", LIVE_TRADE_STATUSES_EXCLUDED)
    return float(rows[0]["total"])


def snapshot_meta(snapshot_id: str) -> dict | None:
    rows = query("SELECT snapshot_id, asset, run_id, COALESCE(source, 'live') AS source FROM SNAPSHOTS "
                 "WHERE snapshot_id = %s", (snapshot_id,))
    return rows[0] if rows else None


def journal(customer_id: str, limit: int = 100) -> list[dict]:
    return query(
        """WITH latest AS (
               SELECT asset, venue, resolution_date, snapshot_id, taken_at, curve_json FROM SNAPSHOTS
               WHERE COALESCE(source, 'live') = 'live'
               QUALIFY ROW_NUMBER() OVER (PARTITION BY asset, venue, resolution_date ORDER BY taken_at DESC) = 1)
           SELECT t.trade_id, t.created_at, t.updated_at, t.asset, t.side, t.usd_amount, t.quote_json, t.order_id,
                  t.status, t.dry_run, t.rationale, t.snapshot_id, t.event_id, t.cited_post_ids, t.evidence_json, t.error,
                  s.venue, s.resolution_date, s.taken_at AS snapshot_taken_at,
                  s.stats_json:p_above_spot AS trade_p,
                  l.snapshot_id AS latest_snapshot_id, l.taken_at AS latest_taken_at, l.curve_json AS latest_curve
           FROM TRADES t
           JOIN SNAPSHOTS s ON s.snapshot_id = t.snapshot_id
           LEFT JOIN latest l ON l.asset = s.asset AND l.venue = s.venue AND l.resolution_date = s.resolution_date
                AND l.taken_at > s.taken_at
           WHERE t.customer_id = %s
           ORDER BY t.created_at DESC LIMIT %s""",
        (customer_id, limit),
    )
