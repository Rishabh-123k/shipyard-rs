"""Probe Snowflake: connect, version, and which Cortex embed/complete functions work."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import snowflake.connector  # noqa: E402
from idt.config import SNOWFLAKE  # noqa: E402

CHECKS = {
    "EMBED_TEXT_768": "SELECT VECTOR_L2_DISTANCE(SNOWFLAKE.CORTEX.EMBED_TEXT_768('snowflake-arctic-embed-m-v1.5','hi'),"
                      " SNOWFLAKE.CORTEX.EMBED_TEXT_768('snowflake-arctic-embed-m-v1.5','hi'))",
    "EMBED_TEXT_1024": "SELECT VECTOR_L2_DISTANCE(SNOWFLAKE.CORTEX.EMBED_TEXT_1024('snowflake-arctic-embed-l-v2.0','hi'),"
                       " SNOWFLAKE.CORTEX.EMBED_TEXT_1024('snowflake-arctic-embed-l-v2.0','hi'))",
    "AI_EMBED": "SELECT AI_EMBED('snowflake-arctic-embed-l-v2.0','hi') IS NOT NULL",
    "CORTEX.COMPLETE": "SELECT SNOWFLAKE.CORTEX.COMPLETE('llama3.1-8b','Reply with OK')",
    "AI_COMPLETE": "SELECT AI_COMPLETE('llama3.1-8b','Reply with OK')",
}


def main() -> None:
    missing = [k for k in ("account", "user", "password", "warehouse") if not SNOWFLAKE[k]]
    if missing:
        sys.exit(f"missing SNOWFLAKE_* env: {missing}")
    conn = snowflake.connector.connect(**{k: v for k, v in SNOWFLAKE.items() if k not in ("database", "schema")})
    cur = conn.cursor()
    print("version:", cur.execute("SELECT CURRENT_VERSION()").fetchone()[0])
    print("region:", cur.execute("SELECT CURRENT_REGION()").fetchone()[0])
    for name, sql in CHECKS.items():
        try:
            print(f"{name:16} OK   {str(cur.execute(sql).fetchone()[0])[:60]!r}")
        except Exception as e:  # noqa: BLE001 - probe reports any failure
            print(f"{name:16} FAIL {str(e).splitlines()[0][:120]}")
    conn.close()


if __name__ == "__main__":
    main()
