// Deep links for the alert buttons.
//
// Telegram start payloads allow up to 64 chars of [A-Za-z0-9_-]. Solana base58
// mints (<=44) and EVM 0x addresses (42) both fit, but anything unexpected is
// dropped rather than turned into a button that goes nowhere.

import { config } from "./config.js";

const START_PAYLOAD_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidStartPayload(payload) {
  return START_PAYLOAD_RE.test(payload);
}

const CHAINS = {
  solana: {
    explorerName: "Solscan",
    token: (a) => `https://solscan.io/token/${a}`,
    tx: (h) => `https://solscan.io/tx/${h}`,
    chart: (a) => `https://dexscreener.com/solana/${a}`,
  },
  robinhood: {
    explorerName: "Explorer",
    token: (a) => `https://robinhoodchain.blockscout.com/token/${a}`,
    tx: (h) => `https://robinhoodchain.blockscout.com/tx/${h}`,
    chart: (a) => `https://dexscreener.com/robinhood/${a}`,
  },
};

// https://t.me/RickBurpBot?start=<contract> — Rick's documented token scan.
export function rickScanUrl(contract) {
  if (!isValidStartPayload(contract)) return null;
  return `https://t.me/${config.rickBotUsername}?start=${contract}`;
}

// Rick's documented deployer-history deeplink, for the wallet that launched it.
export function rickDevUrl(walletAddress) {
  const payload = `dev-${walletAddress}`;
  if (!isValidStartPayload(payload)) return null;
  return `https://t.me/${config.rickBotUsername}?start=${payload}`;
}

export function basedUrl(contract) {
  if (!isValidStartPayload(contract)) return null;
  return `https://t.me/${config.basedBotUsername}?start=${contract}`;
}

/**
 * Inline keyboard for a deploy alert: one tap straight into the trading bots,
 * so the contract address never has to be copied by hand.
 *
 * Layout is action-first — trade/scan on top, then chart & explorer, then the
 * slower context links.
 */
export function buildAlertKeyboard({ chain, contract, walletAddress, txHash, platform }) {
  const c = CHAINS[chain] ?? CHAINS.solana;
  const rows = [];

  const primary = [];
  const based = basedUrl(contract);
  const rick = rickScanUrl(contract);
  if (based) primary.push({ text: "⚡ Trade on Based", url: based });
  if (rick) primary.push({ text: "🔍 Scan with Rick", url: rick });
  if (primary.length) rows.push(primary);

  const research = [
    { text: "📈 Chart", url: c.chart(contract) },
    { text: `🔎 ${c.explorerName}`, url: c.token(contract) },
  ];
  if (platform === "pump.fun") {
    research.push({ text: "🚀 Pump.fun", url: `https://pump.fun/coin/${contract}` });
  }
  rows.push(research);

  const context = [];
  const dev = rickDevUrl(walletAddress);
  if (dev) context.push({ text: "👤 Dev history", url: dev });
  if (txHash) context.push({ text: "🧾 Transaction", url: c.tx(txHash) });
  if (context.length) rows.push(context);

  return { inline_keyboard: rows };
}
