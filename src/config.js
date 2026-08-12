import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramChatId: required("TELEGRAM_CHAT_ID"),
  heliusRpcUrl: required("HELIUS_RPC_URL"),
  robinhoodRpcUrl: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  robinhoodBlockscoutUrl:
    process.env.ROBINHOOD_BLOCKSCOUT_URL || "https://robinhoodchain.blockscout.com/api/v2",
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 15000,
  dataDir: process.env.DATA_DIR || path.resolve(__dirname, "..", "data"),
  seedWallets: parseSeedWallets(process.env.TRACKED_WALLETS),
  // Trading/scanner bots linked from each alert. Overridable so a renamed
  // (or better) bot doesn't need a code change.
  rickBotUsername: process.env.RICK_BOT_USERNAME || "RickBurpBot",
  basedBotUsername: process.env.BASED_BOT_USERNAME || "based_eth_bot",
};

// Hosts with an ephemeral filesystem (Render's free tier) wipe data/ on every
// restart, which would silently leave the bot tracking nothing. Wallets listed
// in TRACKED_WALLETS are re-added on boot: "address:label,address:label".
function parseSeedWallets(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [address, ...label] = entry.split(":");
      return { address: address.trim(), label: label.join(":").trim() || null };
    });
}
