# Tensho Wallet

Tensho is a demo neobank on True Markets rails. Customers sign up with an email and password, get a wallet without ever seeing a seed phrase, fund it by sending USDC to the address the app shows, buy and sell a set of Solana and Base tokens, send tokens to any external wallet, and see their own activity.

Tensho uses the True Markets gateway exactly the way any outside client would. Its server holds an organization API key and a signer key, maps each Tensho customer to a gateway user, and makes every True Markets call on that customer's behalf. The browser only ever talks to Tensho's own server and never sees a True Markets credential.

> [!WARNING]
> - **One signer key seats every customer's wallet.** Tensho creates it on first start at `data/wallet-signer-key`. If you delete or lose that file, every wallet it seated is locked for good. Back it up before you fund anything.
> - **There is no sandbox.** Trades and sends move real funds on Solana mainnet.
> - **Funding means sending tokens to the address the app shows.** There is no card or bank deposit.

## Requirements

- Node 22 or newer with npm, or Docker.
- A True Markets organization with an API key downloaded from the developer console (a JSON file).

## Setup

1. Install dependencies with `npm install`.
2. Move the API key you downloaded from the developer console into `.secrets/`. Everything in that folder is gitignored and kept out of the Docker image, and Tensho finds the key on its own. To keep it somewhere else, set `TM_API_KEY_PATH` to the file.
That's all the setup. Tensho talks to https://api.truemarkets.co, creates the wallet signer key on first start and reads your organization id from the API key's token. Optional overrides go in a `.env` file: `TM_TOKENS` (the tokens offered for trading, comma-separated, `SYMBOL` for Solana or `SYMBOL@base` for Base; the default is 16 Solana and 4 Base tokens) and `PORT` (default `4747`). Tensho keeps its state in `data/` (customers, session secret and the wallet signer key); delete that folder to start over, but only once no wallet it created holds funds.

## Run

For development, `npm run dev` starts the server on port 4747 and the web app on http://localhost:5173 with hot reload. The web app proxies `/api` to the server.

For a single command, `docker compose up --build` builds the web app and serves everything on http://localhost:4747. The key stays out of the image; compose mounts `.secrets/` read-only into the container.

`npm run build && npm start` does the same without Docker. Customer records are kept in `data/customers.json`, next to a session-signing secret the server generates on first boot.

## How it works

Every True Markets call lives in `server/tm/`, which uses only `fetch` and `node:crypto`, so you can lift it into another stack:

- `apikey.ts` reads the API key file the developer console downloads.
- `keys.ts` generates the wallet signer key and turns it into a signing key and its compressed public key.
- `token.ts` gets an organization access token by signing `<key_id>.<unix seconds>` with the org key and posting it to `/v1/auth/api-key/token`, caches the token and renews it two minutes before it expires. The organization id comes from the token's claims.
- `stamp.ts` signs a payload with the signer key and wraps the signature in the stamp format `/execute` expects.
- `client.ts` sends each request with `Authorization: Bearer <org token>` and, for calls made for a customer, `TM-On-Behalf-Of: <gateway user id>`, and passes True Markets errors through unchanged.
- `gateway.ts` has one typed function per endpoint the app uses.

Signing up creates a gateway user through `POST /v1/account/organizations/{organization_id}/users` with the customer's id as `external_ref_id` and the signer public key. That call is idempotent, so if the wallet step fails, signing in again finishes it.

Orders and sends follow prepare, sign, execute. `POST /v1/gateway/orders` (or `/transfers`) returns a quote plus unsigned payloads, which the server keeps in memory; on confirm the server stamps each payload with the signer key and posts the stamps to `/execute`, then polls until the order or transfer settles. The server only ever signs payloads it received from True Markets itself, never anything the browser sends.

A Solana payload carries a recent blockhash that the network stops accepting after about a minute, so the trade ticket asks for a fresh quote every 10 seconds while an amount is entered. On confirm, a quote older than 20 seconds is prepared again before signing, so what gets signed is never stale.

Token prices come from `/v1/defi/market/prices/history`, polled every 15 seconds. Balances and portfolio value come from `/v1/gateway/portfolio`, falling back to `/v1/gateway/balances` with those polled prices when portfolio pricing is unavailable. Activity comes from `/v1/gateway/transactions`.

Prepared quotes live in the server's memory, so running two server instances, or restarting between reviewing and confirming a trade, asks the customer to review the quote again.

## What it deliberately doesn't do

- Deposits don't appear in Activity; they show up as balance changes only.
- No limit orders, fiat on or off ramps, webhooks or streaming prices. Trading covers Solana and Base only.
- No fee breakdown beyond what the quote returns.
- No signer key rotation.
- No organization or API key registration inside the app; that is the developer console's job.
- No production hardening: no rate limiting, no HTTPS termination and no shared state across instances.
