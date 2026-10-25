# cryptoshi

**An implied distribution terminal for crypto. See what prediction markets think BTC and ETH will do, find out why they changed their minds, and trade on it.**

🏆 **Winner, Best Use of Snowflake (MLH)**

[![Watch the demo](https://img.youtube.com/vi/1qGkN76frgw/maxresdefault.jpg)](https://www.youtube.com/watch?v=1qGkN76frgw)

## What it does

Kalshi and Polymarket list dozens of "Will BTC be above $X on Friday?" contracts. Each one is a single price, but together they form a full probability distribution for where the asset will land. cryptoshi stitches those ladders together into one clean curve, watches it every five minutes, and tells you when the market's view moves.

When it does move, cryptoshi goes looking for the reason. It pulls real X posts from that exact window, scores how they feel about the price, and checks whether the crowd and the market agree. Then you can ask it questions in plain English and get short, cited answers grounded only in that stored evidence.

- **Markets**: live implied distributions for BTC and ETH, with medians, percentiles and the chance of finishing above spot.
- **Shifts**: a feed of every material move in the market's view, each linked to the posts published while it happened.
- **Ask**: a RAG chatbot. Ask "Why did BTC's implied median drop overnight?" and get an answer where every claim cites a market event `[E1]` or a post `[P2]`.
- **Sentiment**: every post is labeled positive, negative, neutral or mixed toward the Bitcoin or Ethereum price, rolled into a crowd score, and compared with how the market actually moved.
- **Trade**: buy and sell BTC and ETH from a self-custodied wallet, with the current evidence shown right beside the ticket.
- **Journal**: every trade is saved with the evidence you saw when you placed it, so you can later check whether your thesis held up.

## How we used Snowflake

Snowflake is the whole data and AI layer. There is no separate vector database, embedding service or LLM host.

| Snowflake feature | What it does in cryptoshi |
|---|---|
| Tables and `VARIANT` | Stores every snapshot, contract, shift event, X post, search run and trade |
| `VECTOR(FLOAT, 1024)` | Holds embeddings for snapshots, shift events and posts |
| `AI_EMBED` (`snowflake-arctic-embed-l-v2.0`) | Embeds new rows in place with a single `UPDATE` |
| `VECTOR_COSINE_SIMILARITY` | Ranks shift events and posts against the user's question |
| `AI_SENTIMENT` | Scores each post toward the Bitcoin price and the Ethereum price separately |
| `AI_COMPLETE` (`llama3.3-70b`) | Writes the final cited answer at temperature 0 |

Retrieval and generation happen in the same place the data lives, so one SQL query can filter by asset and time window, join the before and after snapshots, and rank by vector similarity all at once.

## How the RAG chatbot stays honest

Financial answers are only useful if you can trust the numbers, so the Ask pipeline is built to refuse rather than guess.

1. **Parse.** The question is parsed for asset, venue and time window ("last 3 hours", "overnight", "yesterday") and those become hard SQL filters.
2. **Retrieve.** Shift events are ranked by cosine similarity. Posts are then searched only among the ones already linked to those events, so the chatbot never pulls in unrelated tweets.
3. **Ground.** Each piece of evidence becomes a numbered line. All numbers are computed from SQL, not from embedded text.
4. **Generate.** Llama 3.3 70B answers in at most four sentences and must cite evidence for every claim.
5. **Verify.** Any sentence containing a number that does not appear in the evidence is removed. Citations to evidence that does not exist are stripped. If there is no evidence for the window, the app says so instead of answering from general knowledge.

The X posts get the same treatment. Grok's `x_search` is used only to fetch posts, and a post is kept only if the server-side citations confirm it exists. Each timestamp is decoded from the post ID itself, not from the model's output.

## Architecture

```
Kalshi + Polymarket ladders ─┐
True Markets spot price ─────┼─► Python engine ─► Snowflake ◄─ Grok x_search (posts)
                             │   (fit, diff,       │  AI_EMBED, AI_SENTIMENT,
                             │    detect shifts)   │  vector search, AI_COMPLETE
                             │                     ▼
                             └──────────────► FastAPI ◄─ Hono server ◄─ React web app
                                                         (auth, wallet,
                                                          True Markets gateway)
```

- **Engine** (`idt/`): Python. It fits a coherent probability curve to each ladder, detects shifts using median moves, probability moves and Wasserstein distance, runs X searches, and serves the API with FastAPI.
- **Server** (`app/server/`): TypeScript on Hono. It handles accounts and sessions and proxies the engine. It also handles wallet and trading calls through the True Markets gateway; the wallet is forked from True Markets' Tensho example.
- **Web** (`app/web/`): React, Vite, TanStack Query and Tailwind.

## Running it locally

You need Python 3.11+, Node 22+, a Snowflake account with Cortex AI functions enabled, an xAI API key, and a True Markets API key.

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt fastapi uvicorn
```

Copy the example environment file and fill in your Snowflake credentials, `XAI_API_KEY` and `TM_KEY_FILE`. The other values in it are working defaults you can tune.

```bash
cp .env.example .env
```

Then seed some history:

```bash
.venv/bin/python scripts/backfill.py --hours 24
```

```bash
npm --prefix app install
npm --prefix app run dev
```

```bash
npm --prefix app run snapshots
```

The backfill seeds a day of history. `dev` starts the engine, the server and the web app at http://localhost:5173. `snapshots` keeps live data flowing every five minutes.

> **Note:** trades go through the True Markets gateway. `DRY_RUN=true` is the default, and `MAX_ORDER_USD` and `MAX_TOTAL_USD` cap real spending when you turn it off.

## Tests

```bash
.venv/bin/pytest tests
```

```bash
npm --prefix app test
```

## Disclaimer

cryptoshi is a hackathon project. Market-implied probabilities and post sentiment are descriptive, not trading advice.
