"""Grounded answers: numbers rendered from SQL, narrative claims tied to retrieved posts."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from idt import config
from idt.engine import CAVEATS
from idt.rag import retrieve
from idt.rag.parse import cited_ids, enforce, parse_question
from idt.store import snowflake as store

PROMPT = """You answer questions about shifts in prediction-market implied price distributions for crypto assets.
Use ONLY the evidence below. Rules:
- Answer in at most 4 sentences, plain prose, no lists or headings.
- Write citations in square brackets right after the claim, exactly like [E1] or [P2][P5]. Never write "as seen in E1".
- Every statement about how the distribution moved must cite an event, like [E1].
- Every statement about why it moved must cite one or more posts, like [P2]. If the posts don't explain the move, say the stored posts don't explain it.
- Copy numbers exactly as written in the evidence. Never compute, round, convert or estimate a number.
- Do not use outside knowledge.

QUESTION: {question}

EVIDENCE:
{evidence}

ANSWER:"""


def _money(v: float | None) -> str:
    return "n/a" if v is None else f"${v:,.0f}" if v >= 10_000 else f"${v:,.2f}"


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{v * 100:.1f}%"


def _utc(iso: str) -> str:
    return datetime.fromisoformat(iso).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def event_line(i: int, e: dict) -> str:
    dp = None if e["p_before"] is None or e["p_after"] is None else (e["p_after"] - e["p_before"]) * 100
    return (
        f"[E{i}] {e['asset']} {e['venue']} ladder resolving {_utc(e['resolution_at'])}; shift between "
        f"{_utc(e['window_start'])} and {_utc(e['window_end'])}"
        f"{' (reconstructed from price history)' if e['source'] == 'backfill' else ''}. "
        f"Median {_money(e['median_before'])} -> {_money(e['median_after'])}. "
        f"Probability of finishing above {_money(e['level'])}: {_pct(e['p_before'])} -> {_pct(e['p_after'])}"
        f"{'' if dp is None else f' ({dp:+.1f} percentage points)'}."
        + sentiment_clause(e)
    )


def sentiment_clause(e: dict) -> str:
    s = e.get("sentiment") or {}
    idx = s.get("overall") or {}
    if not idx.get("scored"):
        return ""
    return (f" Posts inside the window toward the {e['asset']} price (Snowflake AI_SENTIMENT): "
            f"{idx['positive']} positive, {idx['negative']} negative, {idx['neutral'] + idx['mixed']} neutral or mixed. "
            f"{s['alignment']['text']}")


def post_line(i: int, p: dict) -> str:
    when = "inside the shift window" if p["in_window"] else "outside the shift window"
    text = p["text"] or "(text not returned; link only)"
    tone = f", sentiment toward the price: {p['sentiment']}" if p.get("sentiment") else ""
    return f'[P{i}] @{p["author"] or "unknown"} at {_utc(p["posted_at"])} ({when}{tone}): "{text}"'


def state_line(i: int, s: dict) -> str:
    q50 = next((x["value"] for x in s.get("quantiles") or [] if abs(x["q"] - 0.5) < 1e-9), None)
    p = s.get("p_above_spot") or {}
    return (f"[E{i}] Latest {s['asset']} {s['venue']} ladder resolving {_utc(s['resolution_at'])}, snapshot "
            f"{_utc(s['taken_at'])}: median {_money(q50)}, probability above spot {_money(p.get('level'))}: "
            f"{_pct(p.get('prob'))}.")


def complete(prompt: str) -> str:
    raw = store.query("SELECT AI_COMPLETE(%s, %s, {'temperature': 0, 'max_tokens': 400}) AS r",
                      (config.COMPLETE_MODEL, prompt))[0]["r"]
    try:
        return json.loads(raw) if isinstance(raw, str) and raw.startswith('"') else str(raw)
    except ValueError:
        return str(raw)


def ask(question: str, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    q = parse_question(question, now)
    meta = {"question": question, "assets": q.assets, "venue": q.venue, "window": {
        "start": q.start.isoformat(), "end": q.end.isoformat(), "label": q.window_label}}

    evs = retrieve.events(q)
    found_posts = retrieve.posts(q, [e["event_id"] for e in evs])
    state = [] if evs else retrieve.current_state(q)

    if not evs and not found_posts:
        return {**meta, "refused": True,
                "answer": f"I don't have stored shift events or X posts for {', '.join(q.assets)} in the "
                          f"{q.window_label}, so I can't answer from evidence. I won't answer from general knowledge.",
                "numbers": [], "state": state, "posts": [], "warnings": [], "caveats": CAVEATS}

    blocks: list[str] = []
    for i, e in enumerate(evs, 1):
        e["ref"] = f"E{i}"
        blocks.append(event_line(i, e))
    for j, s in enumerate(state, len(evs) + 1):
        s["ref"] = f"E{j}"
        blocks.append(state_line(j, s))
    for i, p in enumerate(found_posts, 1):
        p["ref"] = f"P{i}"
        blocks.append(post_line(i, p))
    ids = {b.split("]")[0][1:] for b in blocks}
    evidence = "\n".join(blocks)

    raw = complete(PROMPT.format(question=question, evidence=evidence))
    # Numbers the user typed (e.g. "last 3 hours") may be echoed; anything else must come from the evidence.
    answer, warnings = enforce(raw, f"{evidence}\n{question}", ids)
    cited = cited_ids(answer)
    if found_posts and not any(c.startswith("P") for c in cited):
        warnings.append("the answer cites no posts, so it explains no cause")
    if not answer:
        answer = "The model's draft didn't survive the grounding checks. See the numbers and posts below."

    return {**meta, "refused": False, "answer": answer, "model": config.COMPLETE_MODEL,
            "numbers": evs, "state": state,
            "posts": sorted(found_posts, key=lambda p: (p["ref"] not in cited, -p["sim"])),
            "cited": cited, "warnings": warnings, "caveats": CAVEATS}
