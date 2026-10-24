"""Probe xAI: list models, run one x_search with a date window, save raw response."""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from idt.config import FIXTURES, XAI_API_KEY, XAI_MODEL  # noqa: E402
from google.protobuf.json_format import MessageToDict  # noqa: E402
from xai_sdk import Client  # noqa: E402
from xai_sdk.chat import user  # noqa: E402
from xai_sdk.tools import x_search  # noqa: E402


def main() -> None:
    if not XAI_API_KEY:
        sys.exit("XAI_API_KEY not set in .env")
    client = Client(api_key=XAI_API_KEY, timeout=180)
    names = [m.name for m in client.models.list_language_models()]
    print("language models:", names)
    model = XAI_MODEL or next((n for n in names if n.startswith("grok-4")), names[0])
    print("using", model)

    to = datetime.now(timezone.utc)
    frm = to - timedelta(days=1)
    chat = client.chat.create(model=model, tools=[x_search(from_date=frm, to_date=to)])
    chat.append(user("What are people on X saying about the Bitcoin price in the last 24 hours? "
                     "Cite specific posts."))
    response = None
    for response, _chunk in chat.stream():
        pass

    out = {
        "model": model,
        "from_date": frm.isoformat(),
        "to_date": to.isoformat(),
        "content": response.content,
        "citations": list(response.citations),
        "inline_citations": [MessageToDict(c) for c in (response.inline_citations or [])],
        "tool_calls": [MessageToDict(t) for t in (response.tool_calls or [])],
        "server_side_tool_usage": str(response.server_side_tool_usage),
        "usage": MessageToDict(response.usage),
    }
    FIXTURES.mkdir(exist_ok=True)
    (FIXTURES / "xsearch_btc_24h.json").write_text(json.dumps(out, indent=2, default=str))
    print(response.content[:800])
    print("\ncitations:", out["citations"][:10])
    print("saved fixtures/xsearch_btc_24h.json")


if __name__ == "__main__":
    main()
