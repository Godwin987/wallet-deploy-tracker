# Solana Deploy Tracker Bot

Telegram bot that watches specific Solana wallets and alerts you the moment one of them deploys a new coin — pump.fun, letsbonk (Raydium LaunchLab), Moonshot, or a direct SPL token mint.

## How it works

Every 15 seconds the bot polls Helius RPC for new transactions from each tracked wallet. Each new transaction is parsed and flagged as a deploy if it initializes a new token mint (`initializeMint` / `initializeMint2`, including via launchpad CPIs) with the tracked wallet as a signer. Detected deploys trigger a Telegram alert with the token name, platform, mint address, and links to Solscan, Dexscreener, and pump.fun.

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
│   ├── index.js      # entry point — wires everything together
│   ├── config.js     # env loading & validation
│   ├── rpc.js        # Helius JSON-RPC client (+ token metadata via DAS)
│   ├── detector.js   # decides if a transaction is a token deploy
│   ├── watcher.js    # polling loop over tracked wallets
│   ├── store.js      # wallet list + poll cursors persisted to disk
│   └── telegram.js   # bot commands & alert formatting
├── scripts/          # connectivity / detection / persistence tests
│   ├── test-rpc.js
│   ├── test-telegram.js
│   ├── test-detector.js
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
npm run test:store      # wallet add/remove/persistence
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
