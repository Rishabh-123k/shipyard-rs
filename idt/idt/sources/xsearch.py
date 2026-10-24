"""Grok x_search: retrieve X posts for a shift window. Posts are evidence; Grok's summary is not."""
from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone

from idt import config

log = logging.getLogger(__name__)

NAMES = {"BTC": "Bitcoin", "ETH": "Ethereum"}
TWITTER_EPOCH_MS = 1288834974657
STATUS_RE = re.compile(r"(?:x|twitter)\.com/(?:i(?:/web)?|([A-Za-z0-9_]{1,15}))/status/(\d+)")

SYSTEM = (
    "You retrieve evidence from X for a market-data terminal. Report only posts you actually retrieved with the "
    "X search tool. Quote post text verbatim; never paraphrase inside the text field and never invent posts, "
    "handles, numbers or URLs. If nothing relevant exists in the window, return an empty posts list."
)


@dataclass
class XPost:
    post_id: str
    url: str
    author: str | None
    posted_at: datetime
    text: str | None
    text_source: str
    in_window: bool

    def to_row(self) -> dict:
        d = asdict(self)
        d["posted_at"] = self.posted_at.isoformat()
        return d


@dataclass
class XSearchResult:
    run_id: str
    asset: str
    query_mode: str
    model: str
    window_start: datetime
    window_end: datetime
    search_from: datetime
    search_to: datetime
    handles: list[str] | None
    summary: str | None = None
    posts: list[XPost] = field(default_factory=list)
    citations: list[str] = field(default_factory=list)
    raw_content: str | None = None
    error: str | None = None

    def run_row(self) -> dict:
        return {
            "run_id": self.run_id, "asset": self.asset, "query_mode": self.query_mode, "model": self.model,
            "window_start": self.window_start.isoformat(), "window_end": self.window_end.isoformat(),
            "search_from": self.search_from.isoformat(), "search_to": self.search_to.isoformat(),
            "handles": self.handles, "grok_summary": self.summary, "citations": self.citations,
            "raw_content": self.raw_content, "error": self.error,
        }


def post_id_from_url(url: str) -> tuple[str, str | None] | None:
    m = STATUS_RE.search(url)
    return (m.group(2), m.group(1)) if m else None


def posted_at(post_id: str) -> datetime:
    """X post IDs are Snowflake IDs: the top bits are milliseconds since the X epoch."""
    return datetime.fromtimestamp(((int(post_id) >> 22) + TWITTER_EPOCH_MS) / 1000, timezone.utc)


def _extract_json(content: str) -> dict | None:
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.S)
    candidates = [fenced.group(1)] if fenced else []
    start, end = content.find("{"), content.rfind("}")
    if start != -1 and end > start:
        candidates.append(content[start:end + 1])
    for c in candidates:
        try:
            obj = json.loads(c)
            if isinstance(obj, dict):
                return obj
        except ValueError:
            continue
    return None


def parse_response(content: str, citations: list[str], window_from: datetime,
                   window_to: datetime) -> tuple[str | None, list[XPost]]:
    """Keep only posts whose IDs are in the server-side citations; time comes from the ID, not the model."""
    cited: dict[str, str | None] = {}
    for url in citations:
        parsed = post_id_from_url(url)
        if parsed:
            cited.setdefault(parsed[0], parsed[1])

    obj = _extract_json(content) or {}
    summary = obj.get("summary") if isinstance(obj.get("summary"), str) else (content.strip() or None) if not obj else None
    posts: dict[str, XPost] = {}

    for item in obj.get("posts") or []:
        if not isinstance(item, dict) or not isinstance(item.get("url"), str):
            continue
        parsed = post_id_from_url(item["url"])
        if not parsed or parsed[0] not in cited:
            log.info("dropping uncited post %s", item.get("url"))
            continue
        pid, handle = parsed
        author = (item.get("author") or handle or cited[pid] or "").lstrip("@") or None
        ts = posted_at(pid)
        posts[pid] = XPost(pid, f"https://x.com/{author or 'i'}/status/{pid}", author, ts,
                           item.get("text") if isinstance(item.get("text"), str) else None,
                           "grok_quote", window_from <= ts <= window_to)

    for pid, handle in cited.items():
        if pid not in posts:
            ts = posted_at(pid)
            posts[pid] = XPost(pid, f"https://x.com/{handle or 'i'}/status/{pid}", handle, ts, None,
                               "citation_only", window_from <= ts <= window_to)

    return summary, sorted(posts.values(), key=lambda p: p.posted_at)


def build_prompt(asset: str, window_from: datetime, window_to: datetime, reasons: list[str]) -> str:
    return (
        f"Between {window_from:%Y-%m-%d %H:%M} and {window_to:%Y-%m-%d %H:%M} UTC, prediction markets' implied "
        f"distribution for the {NAMES[asset]} ({asset}) price shifted: {'; '.join(reasons) or 'a material move'}.\n"
        "Search X for posts published in that window that could explain the move: news, macro data, ETF flows, "
        "liquidations, exchange or on-chain events, large trades, or notable commentary.\n"
        "Respond with ONLY a JSON object, no prose before or after:\n"
        '{"summary": "<2-3 sentences synthesizing what the posts say>", '
        '"posts": [{"url": "https://x.com/<handle>/status/<id>", "author": "<handle>", "text": "<verbatim text>"}]}\n'
        "Up to 10 posts, most relevant first."
    )


def search(asset: str, window_start: datetime, window_end: datetime, mode: str, reasons: list[str],
           run_id: str) -> XSearchResult:
    from xai_sdk import Client
    from xai_sdk.chat import system, user
    from xai_sdk.tools import x_search

    search_from = window_start - timedelta(minutes=config.XSEARCH_LOOKBACK_MINUTES)
    search_to = window_end
    handles = config.CURATED_HANDLES[:20] if mode == "curated" else None
    res = XSearchResult(run_id, asset, mode, config.XAI_MODEL, window_start, window_end, search_from, search_to, handles)
    # x_search filters by whole UTC days (to_date exclusive); posts are then filtered by their ID timestamps.
    day_from = datetime(search_from.year, search_from.month, search_from.day, tzinfo=timezone.utc)
    day_to = datetime(search_to.year, search_to.month, search_to.day, tzinfo=timezone.utc) + timedelta(days=1)
    try:
        client = Client(api_key=config.XAI_API_KEY, timeout=240)
        chat = client.chat.create(
            model=config.XAI_MODEL,
            tools=[x_search(from_date=day_from, to_date=day_to, allowed_x_handles=handles)],
        )
        chat.append(system(SYSTEM))
        chat.append(user(build_prompt(asset, search_from, search_to, reasons)))
        response = None
        for response, _ in chat.stream():
            pass
        res.raw_content = response.content
        res.citations = list(response.citations)
        res.summary, res.posts = parse_response(response.content, res.citations, search_from, search_to)
    except Exception as e:  # noqa: BLE001 - a failed search is recorded, not fatal to the snapshot loop
        log.exception("x_search failed for %s %s", asset, mode)
        res.error = repr(e)
    return res
