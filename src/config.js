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
  dataDir: path.resolve(__dirname, "..", "data"),
};
