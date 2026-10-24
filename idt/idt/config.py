import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

FIXTURES = ROOT / "fixtures"


def _f(name: str, default: float) -> float:
    return float(os.getenv(name, default))


TM_ENV = os.getenv("TM_ENV", "prod")
TM_KEY_FILE = os.getenv("TM_KEY_FILE", "")
XAI_API_KEY = os.getenv("XAI_API_KEY", "")
XAI_MODEL = os.getenv("XAI_MODEL", "")

SNOWFLAKE = {
    "account": os.getenv("SNOWFLAKE_ACCOUNT", ""),
    "user": os.getenv("SNOWFLAKE_USER", ""),
    "password": os.getenv("SNOWFLAKE_PASSWORD", ""),
    "warehouse": os.getenv("SNOWFLAKE_WAREHOUSE", ""),
    "database": os.getenv("SNOWFLAKE_DATABASE", "IDT"),
    "schema": os.getenv("SNOWFLAKE_SCHEMA", "PUBLIC"),
}

DRY_RUN = os.getenv("DRY_RUN", "true").lower() != "false"
MAX_ORDER_USD = _f("MAX_ORDER_USD", 10)
MAX_TOTAL_USD = _f("MAX_TOTAL_USD", 50)

SNAPSHOT_INTERVAL_MINUTES = _f("SNAPSHOT_INTERVAL_MINUTES", 5)
MAX_SPREAD = _f("MAX_SPREAD", 0.10)
MIN_VOLUME = _f("MIN_VOLUME", 0)
SHIFT_THRESHOLD_MEDIAN = _f("SHIFT_THRESHOLD_MEDIAN", 500)
SHIFT_THRESHOLD_P_ABOVE = _f("SHIFT_THRESHOLD_P_ABOVE", 0.03)
SHIFT_THRESHOLD_WASSERSTEIN = _f("SHIFT_THRESHOLD_WASSERSTEIN", 0.02)

CURATED_HANDLES = [
    h.strip()
    for h in os.getenv("CURATED_HANDLES", "coinbase,binance,WatcherGuru,DocumentingBTC,tier10k").split(",")
    if h.strip()
]

POLYMARKET_GAMMA = "https://gamma-api.polymarket.com"
POLYMARKET_CLOB = "https://clob.polymarket.com"
KALSHI_BASE = os.getenv("KALSHI_BASE", "https://api.elections.kalshi.com/trade-api/v2")
