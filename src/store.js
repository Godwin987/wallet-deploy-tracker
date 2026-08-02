// Persistence for tracked wallets (data/wallets.json) and per-wallet
// polling cursors (data/state.json) so restarts don't re-alert old txs.

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const WALLETS_FILE = path.join(config.dataDir, "wallets.json");
const STATE_FILE = path.join(config.dataDir, "state.json");

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

// Address formats don't overlap, so the chain is inferred from the address.
export function detectChain(address) {
  if (EVM_RE.test(address)) return "robinhood";
  if (BASE58_RE.test(address)) return "solana";
  return null;
}

export const CHAIN_NAMES = { solana: "Solana", robinhood: "Robinhood Chain" };

// EVM addresses are case-insensitive hex; Solana base58 is case-sensitive.
function sameAddress(a, b) {
  if (a.startsWith("0x") && b.startsWith("0x")) return a.toLowerCase() === b.toLowerCase();
  return a === b;
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
    for (const w of this.wallets) w.chain ||= "solana"; // pre-EVM entries
    this.state = readJson(STATE_FILE, {}); // { [address]: { lastSignature } }

    for (const seed of config.seedWallets) {
      if (this.getWallet(seed.address)) continue;
      const result = this.addWallet(seed.address, seed.label);
      console.log(
        result.ok
          ? `[store] seeded ${seed.address} from TRACKED_WALLETS`
          : `[store] could not seed ${seed.address}: ${result.error}`
      );
    }
  }

  listWallets(chain) {
    return chain ? this.wallets.filter((w) => w.chain === chain) : [...this.wallets];
  }

  getWallet(address) {
    return this.wallets.find((w) => sameAddress(w.address, address));
  }

  addWallet(address, label) {
    const chain = detectChain(address);
    if (!chain) {
      return {
        ok: false,
        error: "That doesn't look like a valid Solana or EVM (0x…) address.",
      };
    }
    if (this.getWallet(address)) {
      return { ok: false, error: "This wallet is already being tracked." };
    }
    const wallet = { address, label: label || null, chain, addedAt: new Date().toISOString() };
    this.wallets.push(wallet);
    writeJson(WALLETS_FILE, { wallets: this.wallets });
    return { ok: true, wallet };
  }

  removeWallet(address) {
    const index = this.wallets.findIndex((w) => sameAddress(w.address, address));
    if (index === -1) return { ok: false, error: "This wallet is not being tracked." };
    const [wallet] = this.wallets.splice(index, 1);
    delete this.state[wallet.address];
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
