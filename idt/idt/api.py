"""HTTP engine for the web app. Tensho's server proxies /api/idt/* here."""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Query

from idt import engine

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
