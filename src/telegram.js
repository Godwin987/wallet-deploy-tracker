import TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import { getAssetMetadata } from "./rpc.js";

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shortAddress(address) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export class TelegramService {
  /**
   * @param {import("./store.js").Store} store
   * @param {() => object} getStatus
   */
  constructor(store, getStatus) {
    this.store = store;
    this.getStatus = getStatus;
    this.bot = new TelegramBot(config.telegramBotToken, { polling: true });
    this.bot.on("polling_error", (err) => console.error("[telegram] polling error:", err.message));
    this.registerCommands();
    this.bot
      .setMyCommands([
        { command: "add", description: "Track a wallet: /add <address> [label]" },
        { command: "remove", description: "Stop tracking: /remove <address>" },
        { command: "list", description: "Show tracked wallets" },
        { command: "status", description: "Bot health" },
        { command: "help", description: "Show help" },
      ])
      .catch((err) => console.error("[telegram] setMyCommands failed:", err.message));
  }

  // Only the configured chat may control the bot.
  isAuthorized(msg) {
    return String(msg.chat.id) === String(config.telegramChatId);
  }

  send(html) {
    return this.bot.sendMessage(config.telegramChatId, html, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }

  async sendDeployAlert({ wallet, signature, blockTime, mints, platform }) {
    const mint = mints[0];
    const meta = await getAssetMetadata(mint);
    const walletName = wallet.label
      ? `${escapeHtml(wallet.label)} (<code>${shortAddress(wallet.address)}</code>)`
      : `<code>${wallet.address}</code>`;
    const tokenLine = meta?.name
      ? `\n🪙 <b>Token:</b> ${escapeHtml(meta.name)}${meta.symbol ? ` ($${escapeHtml(meta.symbol)})` : ""}`
      : "";
    const time = blockTime ? new Date(blockTime * 1000).toUTCString() : "just now";

    const links = [
      `<a href="https://solscan.io/tx/${signature}">Tx</a>`,
      `<a href="https://solscan.io/token/${mint}">Solscan</a>`,
      `<a href="https://dexscreener.com/solana/${mint}">Dexscreener</a>`,
    ];
    if (platform === "pump.fun") links.push(`<a href="https://pump.fun/coin/${mint}">Pump.fun</a>`);

    const message =
      `🚀 <b>New token deploy detected!</b>\n\n` +
      `👛 <b>Wallet:</b> ${walletName}\n` +
      `🏗 <b>Platform:</b> ${escapeHtml(platform)}${tokenLine}\n` +
      `📍 <b>Mint:</b> <code>${mint}</code>\n` +
      `🕒 <b>Time:</b> ${time}\n\n` +
      links.join(" | ");

    await this.send(message);
  }

  registerCommands() {
    this.bot.onText(/^\/(start|help)\b/, (msg) => {
      if (!this.isAuthorized(msg)) return;
      this.send(
        `👋 <b>Solana Deploy Tracker</b>\n\n` +
          `I watch your tracked wallets and alert you the moment one of them deploys a new coin.\n\n` +
          `<b>Commands:</b>\n` +
          `/add &lt;wallet&gt; [label] — track a new wallet\n` +
          `/remove &lt;wallet&gt; — stop tracking a wallet\n` +
          `/list — show tracked wallets\n` +
          `/status — bot health`
      );
    });

    this.bot.onText(/^\/list\b/, (msg) => {
      if (!this.isAuthorized(msg)) return;
      const wallets = this.store.listWallets();
      if (!wallets.length) {
        this.send("No wallets tracked yet. Add one with:\n<code>/add &lt;wallet address&gt; [label]</code>");
        return;
      }
      const lines = wallets.map(
        (w, i) => `${i + 1}. <code>${w.address}</code>${w.label ? ` — ${escapeHtml(w.label)}` : ""}`
      );
      this.send(`👛 <b>Tracked wallets (${wallets.length}):</b>\n\n${lines.join("\n")}`);
    });

    this.bot.onText(/^\/add(?:@\w+)?(?:\s+(\S+))?(?:\s+(.+))?$/, async (msg, match) => {
      if (!this.isAuthorized(msg)) return;
      const address = match[1];
      const label = match[2]?.trim();
      if (!address) {
        this.send("Usage: <code>/add &lt;wallet address&gt; [label]</code>");
        return;
      }
      const result = this.store.addWallet(address, label);
      if (!result.ok) {
        this.send(`⚠️ ${escapeHtml(result.error)}`);
        return;
      }
      this.send(
        `✅ <b>Now tracking</b> <code>${address}</code>` +
          (label ? ` as <b>${escapeHtml(label)}</b>` : "") +
          `\n\nYou'll be alerted the moment this wallet deploys a coin.`
      );
    });

    this.bot.onText(/^\/remove(?:@\w+)?(?:\s+(\S+))?$/, (msg, match) => {
      if (!this.isAuthorized(msg)) return;
      const address = match[1];
      if (!address) {
        this.send("Usage: <code>/remove &lt;wallet address&gt;</code>");
        return;
      }
      const result = this.store.removeWallet(address);
      if (!result.ok) {
        this.send(`⚠️ ${escapeHtml(result.error)}`);
        return;
      }
      this.send(`🗑 Stopped tracking <code>${address}</code>.`);
    });

    this.bot.onText(/^\/status\b/, (msg) => {
      if (!this.isAuthorized(msg)) return;
      const s = this.getStatus();
      this.send(
        `✅ <b>Bot status</b>\n\n` +
          `Tracked wallets: ${this.store.listWallets().length}\n` +
          `Poll interval: ${config.pollIntervalMs / 1000}s\n` +
          `Last poll: ${s.lastTickAt ? s.lastTickAt.toUTCString() : "starting up…"}\n` +
          `Uptime since: ${s.startedAt ? s.startedAt.toUTCString() : "-"}\n` +
          `RPC errors: ${s.errors}`
      );
    });
  }
}
