// Persistence for tracked wallets (data/wallets.json) and per-wallet
// polling cursors (data/state.json) so restarts don't re-alert old txs.

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const WALLETS_FILE = path.join(config.dataDir, "wallets.json");
const STATE_FILE = path.join(config.dataDir, "state.json");

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidSolanaAddress(address) {
  return BASE58_RE.test(address);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export class Store {
  constructor() {
    this.wallets = readJson(WALLETS_FILE, { wallets: [] }).wallets;
    this.state = readJson(STATE_FILE, {}); // { [address]: { lastSignature } }
  }

  listWallets() {
    return [...this.wallets];
  }

  getWallet(address) {
    return this.wallets.find((w) => w.address === address);
  }

  addWallet(address, label) {
    if (!isValidSolanaAddress(address)) {
      return { ok: false, error: "That doesn't look like a valid Solana address." };
    }
    if (this.getWallet(address)) {
      return { ok: false, error: "This wallet is already being tracked." };
    }
    const wallet = { address, label: label || null, addedAt: new Date().toISOString() };
    this.wallets.push(wallet);
    writeJson(WALLETS_FILE, { wallets: this.wallets });
    return { ok: true, wallet };
  }

  removeWallet(address) {
    const index = this.wallets.findIndex((w) => w.address === address);
    if (index === -1) return { ok: false, error: "This wallet is not being tracked." };
    const [wallet] = this.wallets.splice(index, 1);
    delete this.state[address];
    writeJson(WALLETS_FILE, { wallets: this.wallets });
    writeJson(STATE_FILE, this.state);
    return { ok: true, wallet };
  }

  getLastSignature(address) {
    return this.state[address]?.lastSignature ?? null;
  }

  setLastSignature(address, signature) {
    this.state[address] = { lastSignature: signature };
    writeJson(STATE_FILE, this.state);
  }
}
