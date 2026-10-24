"""Thin wrapper over the truemarkets SDK (v0.3.0) gateway."""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from truemarkets import Client
from truemarkets._generated.authapi.models import access_tokens_response as _atr
from truemarkets._generated.gateway.models import OrderSide, QuoteRequest, QuoteRequestQtyUnit

from idt.config import TM_KEY_FILE

# The API-key token exchange returns no refresh_token, but the generated model requires one.
_orig_from_dict = _atr.AccessTokensResponse.from_dict.__func__


def _from_dict(cls, src_dict):
    d = dict(src_dict)
    d.setdefault("refresh_token", "")
    return _orig_from_dict(cls, d)


_atr.AccessTokensResponse.from_dict = classmethod(_from_dict)

_REAUTH_AFTER_S = 30 * 60


def to_dict(obj: Any) -> Any:
    return obj.to_dict() if hasattr(obj, "to_dict") else obj


@dataclass
class SpotQuote:
    asset: str
    price: float
    bid: float | None
    ask: float | None
    taken_at: datetime
    raw: dict

    @property
    def spread_bps(self) -> float | None:
        if self.bid is None or self.ask is None:
            return None
        return (self.ask - self.bid) / ((self.ask + self.bid) / 2) * 1e4


class TrueMarkets:
    def __init__(self, key_file: str = TM_KEY_FILE):
        self._c = Client(key_file=key_file)
        self._authed_at = 0.0

    @property
    def gateway(self):
        if time.monotonic() - self._authed_at > _REAUTH_AFTER_S:
            self._c.authenticate()
            self._authed_at = time.monotonic()
        return self._c.gateway

    def sign(self, payload: str) -> str:
        return self._c.sign_turnkey(payload)

    def list_assets(self) -> dict:
        return to_dict(self.gateway.list_assets())

    def balances(self) -> dict:
        return to_dict(self.gateway.get_balances())

    def quote(self, asset: str, side: str, usd: float, quote_asset: str = "USDC") -> dict:
        body = QuoteRequest(base_asset=asset, quote_asset=quote_asset, qty=f"{usd:.2f}",
                            qty_unit=QuoteRequestQtyUnit.QUOTE, side=OrderSide(side))
        return to_dict(self.gateway.compute_quote(body=body))

    def close(self) -> None:
        self._c.close()
