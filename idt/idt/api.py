"""HTTP engine for the web app. Tensho's server proxies /api/idt/* here."""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from typing import Literal

from idt import engine, evidence, queries
from idt.rag import answer
from idt.store import snowflake as store

logging.basicConfig(level=logging.INFO)

ASSETS = ("BTC", "ETH")

app = FastAPI(title="IDT engine")


def _asset(asset: str) -> str:
    a = asset.upper()
    if a not in ASSETS:
        raise HTTPException(400, f"asset must be one of {ASSETS}")
    return a


@app.get("/api/idt/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/idt/ladders")
def ladders(asset: str = "BTC") -> list[dict]:
    return engine.catalog(_asset(asset))


@app.get("/api/idt/distribution")
def distribution(asset: str = "BTC", venue: str = Query(...), resolution_at: str = Query(...)) -> dict:
    d = engine.distribution(_asset(asset), venue, resolution_at)
    if d is None:
        raise HTTPException(404, "no ladder for that venue and date")
    return d


@app.get("/api/idt/spot")
def spot(asset: str = "BTC") -> dict:
    return engine.spot(_asset(asset))


@app.get("/api/idt/shifts")
def shifts(asset: str = "BTC", hours: float = Query(24, gt=0, le=24 * 14)) -> list[dict]:
    return queries.list_shifts(_asset(asset), hours)


@app.get("/api/idt/shifts/{event_id}")
def shift(event_id: str) -> dict:
    d = queries.shift_detail(event_id)
    if d is None:
        raise HTTPException(404, "no such shift event")
    return d


@app.get("/api/idt/evidence")
def get_evidence(asset: str = "BTC") -> dict:
    return evidence.evidence(_asset(asset))


# /internal/* is called only by the app server (the browser proxy forwards /api/idt/* alone).

@app.get("/internal/quote")
def cefi_quote(asset: str, side: Literal["buy", "sell"], usd: float = Query(gt=0, le=10_000)) -> dict:
    """A CeFi compute_quote for dry-run simulation when the wallet can't fill a DeFi order."""
    return engine.truemarkets_quote(_asset(asset), side, usd)


@app.get("/internal/evidence/version")
def evidence_version(asset: str) -> dict:
    return {"asset": _asset(asset), "version": evidence.version(_asset(asset))}


class TradeIn(BaseModel):
    trade_id: str = Field(min_length=8, max_length=64)
    customer_id: str = Field(min_length=1, max_length=64)
    asset: str
    side: Literal["buy", "sell"]
    usd_amount: float = Field(gt=0)
    status: str
    dry_run: bool
    order_id: str | None = None
    quote: dict | None = None
    version: str
    snapshot_id: str
    event_id: str | None = None
    cited_post_ids: list[str] = Field(default_factory=list, max_length=20)
    rationale: str | None = Field(default=None, max_length=1000)


@app.post("/internal/trades")
def record_trade(t: TradeIn) -> dict:
    asset = _asset(t.asset)
    snap = store.snapshot_meta(t.snapshot_id)
    if not snap or snap["asset"] != asset or snap["source"] != "live" or snap["run_id"] != t.version:
        raise HTTPException(409, "evidence snapshot doesn't match the confirmed evidence version")
    if t.event_id and not store.query("SELECT 1 FROM SHIFT_EVENTS WHERE event_id = %s AND asset = %s", (t.event_id, asset)):
        raise HTTPException(409, "unknown shift event for this asset")
    ev = evidence.evidence(asset)
    store.insert_trade({**t.model_dump(), "asset": asset, "evidence": {
        "version": t.version, "ladders": ev["ladders"], "event": ev["event"]}})
    return {"trade_id": t.trade_id}


class TradeUpdate(BaseModel):
    status: str
    order_id: str | None = None
    error: str | None = Field(default=None, max_length=2000)


@app.patch("/internal/trades/{trade_id}")
def patch_trade(trade_id: str, u: TradeUpdate) -> dict:
    store.update_trade(trade_id, u.status, u.order_id, u.error)
    return {"trade_id": trade_id, "status": u.status}


@app.get("/internal/trades/total")
def trades_total() -> dict:
    return {"total_usd": store.live_trades_total_usd()}


@app.get("/internal/journal")
def get_journal(customer_id: str) -> list[dict]:
    out = []
    for r in store.journal(customer_id):
        out.append({
            "trade_id": r["trade_id"], "created_at": r["created_at"].isoformat(), "asset": r["asset"],
            "side": r["side"], "usd_amount": r["usd_amount"], "quote": r["quote_json"], "order_id": r["order_id"],
            "status": r["status"], "dry_run": r["dry_run"], "rationale": r["rationale"], "error": r["error"],
            "snapshot_id": r["snapshot_id"], "venue": r["venue"], "resolution_at": r["resolution_date"].isoformat(),
            "snapshot_taken_at": r["snapshot_taken_at"].isoformat(), "event_id": r["event_id"],
            "cited_post_ids": r["cited_post_ids"] or [], "evidence": r["evidence_json"],
            "thesis": evidence.thesis(r),
        })
    return out


class AskBody(BaseModel):
    question: str = Field(min_length=3, max_length=500)


@app.post("/api/idt/ask")
def ask(body: AskBody) -> dict:
    return answer.ask(body.question)
