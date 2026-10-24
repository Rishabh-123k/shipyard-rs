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
    "role": os.getenv("SNOWFLAKE_ROLE") or None,
}

DRY_RUN = os.getenv("DRY_RUN", "true").lower() != "false"
MAX_ORDER_USD = _f("MAX_ORDER_USD", 10)
MAX_TOTAL_USD = _f("MAX_TOTAL_USD", 50)

SNAPSHOT_INTERVAL_MINUTES = _f("SNAPSHOT_INTERVAL_MINUTES", 5)
MAX_SPREAD = _f("MAX_SPREAD", 0.10)
MIN_VOLUME = _f("MIN_VOLUME", 0)
# Shift thresholds are relative to price so one setting works for BTC and ETH.
SHIFT_REL_MEDIAN = _f("SHIFT_REL_MEDIAN", 0.004)
SHIFT_P_ABOVE = _f("SHIFT_P_ABOVE", 0.03)
SHIFT_REL_WASSERSTEIN = _f("SHIFT_REL_WASSERSTEIN", 0.003)
# Ladders this close to resolution narrow mechanically; skip them for shift detection.
SHIFT_MIN_HOURS_TO_RESOLUTION = _f("SHIFT_MIN_HOURS_TO_RESOLUTION", 2)
# Posts are searched from this many minutes before a shift window to its end.
XSEARCH_LOOKBACK_MINUTES = _f("XSEARCH_LOOKBACK_MINUTES", 60)
XSEARCH_COOLDOWN_MINUTES = _f("XSEARCH_COOLDOWN_MINUTES", 30)

EMBED_MODEL = os.getenv("EMBED_MODEL", "snowflake-arctic-embed-l-v2.0")
EMBED_DIM = 1024
COMPLETE_MODEL = os.getenv("COMPLETE_MODEL", "llama3.3-70b")
RAG_SIMILARITY_FLOOR = _f("RAG_SIMILARITY_FLOOR", 0.3)

CURATED_HANDLES = [
    h.strip()
    for h in os.getenv("CURATED_HANDLES", "coinbase,binance,WatcherGuru,DocumentingBTC,tier10k").split(",")
    if h.strip()
]

POLYMARKET_GAMMA = "https://gamma-api.polymarket.com"
POLYMARKET_CLOB = "https://clob.polymarket.com"
KALSHI_BASE = os.getenv("KALSHI_BASE", "https://api.elections.kalshi.com/trade-api/v2")
