# Deploy Tracker Bot (Solana + Robinhood Chain)

Telegram bot that watches specific wallets and alerts you the moment one of them deploys a new coin:

- **Solana** — pump.fun, letsbonk (Raydium LaunchLab), Moonshot, or a direct SPL token mint (via Helius RPC)
- **Robinhood Chain** (Ethereum L2, chain id 4663) — direct ERC-20 contract deploys and factory/launchpad deploys (via the public Robinhood RPC + Blockscout API, no key needed)

The chain is auto-detected from the address format when you `/add` a wallet — base58 → Solana, `0x…` → Robinhood Chain.

## How it works

Every 15 seconds each chain's watcher polls for new transactions from its tracked wallets.

- **Solana:** a transaction is a deploy if it initializes a new token mint (`initializeMint` / `initializeMint2`, including via launchpad CPIs) with the tracked wallet as a signer.
- **Robinhood Chain:** a transaction is a deploy if it creates a contract — directly (`to == null`) or through a factory (internal `create`/`create2`) — and the created contract answers ERC-20 `name()`/`symbol()` calls, filtering out non-token contracts.

Detected deploys trigger a Telegram alert with the token name, platform/chain, contract address, and explorer links.

## Setup

1. Copy `.env.example` to `.env` and fill in your Telegram bot token, chat id, and Helius RPC URL.
2. Install and start:

```bash
npm install
npm start
```

## Telegram commands

Only the chat configured in `TELEGRAM_CHAT_ID` can control the bot.

| Command | What it does |
| --- | --- |
| `/add <address> [label]` | Start tracking a wallet (takes effect immediately, no restart) |
| `/remove <address>` | Stop tracking a wallet |
| `/list` | Show all tracked wallets |
| `/status` | Poll health, uptime, error count |
| `/help` | Show commands |

Example: `/add 7HrbKX8Dygk8wmBYnSAKhf6sd4R5TRGQtMmuGmTdc2g cooked dev`

## Project structure

```
├── src/
│   ├── index.js         # entry point — wires everything together
│   ├── config.js        # env loading & validation
│   ├── rpc.js           # Helius JSON-RPC client (+ token metadata via DAS)
│   ├── detector.js      # Solana: decides if a transaction is a token deploy
│   ├── watcher.js       # Solana: polling loop over tracked wallets
│   ├── evm-rpc.js       # Robinhood Chain: RPC + Blockscout API + ERC-20 reads
│   ├── evm-detector.js  # Robinhood Chain: contract-creation → token detection
│   ├── evm-watcher.js   # Robinhood Chain: polling loop
│   ├── store.js         # chain-aware wallet list + poll cursors on disk
│   └── telegram.js      # bot commands & per-chain alert formatting
├── scripts/             # connectivity / detection / persistence tests
│   ├── test-rpc.js
│   ├── test-telegram.js
│   ├── test-detector.js
│   ├── test-evm.js
│   └── test-store.js
├── data/
│   ├── wallets.json  # tracked wallets (persisted)
│   └── state.json    # last-seen tx per wallet (auto-generated)
└── .env              # secrets (gitignored)
```

## Tests

```bash
npm run test:rpc        # Helius connectivity
npm run test:telegram   # bot token + chat id (sends a test message)
npm run test:detector   # runs the detector on a real recent pump.fun launch
npm run test:evm        # Robinhood Chain RPC, detection on a real factory deploy, chain detection
npm run test:store      # wallet add/remove/persistence (both chains)
```

## Deploying on Render

The bot binds an HTTP health-check server when the `PORT` env var is set (Render sets it automatically), so it passes Render's port scan when deployed as a **Web Service**.

- Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `HELIUS_RPC_URL` in the Render dashboard under Environment (there is no `.env` in the repo).
- **Free tier spins down after ~15 min without inbound traffic — a spun-down bot misses deploys.** Keep it awake by pointing a free uptime pinger (e.g. UptimeRobot) at your service URL every 5 minutes, or upgrade / use a Background Worker.
- Render's free filesystem is ephemeral: wallets added with `/add` are lost on every redeploy or restart. Attach a persistent disk mounted at `/data` (and point `dataDir` there) if you need them to survive.
- Only run one instance per bot token — stop any local copy, or Telegram returns `409 Conflict`.

## Notes

- On the first poll of a newly added wallet the bot records the wallet's latest transaction and only alerts on activity after that point — no spam from history.
- Cursors are persisted in `data/state.json`, so restarting doesn't re-alert old deploys.
- Failed transactions and non-deploy activity (transfers, swaps) are ignored.
