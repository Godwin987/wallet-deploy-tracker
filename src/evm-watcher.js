// Polls Robinhood Chain (via Blockscout) for new outgoing transactions from
// each tracked EVM wallet and fires onDeploy() for token deploys.

import { getOutgoingTransactions } from "./evm-rpc.js";
import { detectEvmDeploy } from "./evm-detector.js";
import { config } from "./config.js";

const MAX_TXS_PER_TICK = 10; // each candidate tx can cost extra API calls

export class EvmWatcher {
  /**
   * @param {import("./store.js").Store} store
   * @param {(payload: object) => Promise<void>} onDeploy
   */
  constructor(store, onDeploy) {
    this.store = store;
    this.onDeploy = onDeploy;
    this.timer = null;
    this.running = false;
    this.startedAt = null;
    this.lastTickAt = null;
    this.errors = 0;
  }

  start() {
    if (this.timer) return;
    this.startedAt = new Date();
    const loop = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.tick();
        this.lastTickAt = new Date();
      } catch (err) {
        this.errors++;
        console.error("[evm-watcher] tick failed:", err.message);
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(loop, config.pollIntervalMs);
    loop();
    console.log(`[evm-watcher] started, polling every ${config.pollIntervalMs / 1000}s`);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    for (const wallet of this.store.listWallets("robinhood")) {
      try {
        await this.checkWallet(wallet);
      } catch (err) {
        this.errors++;
        console.error(`[evm-watcher] ${wallet.address}: ${err.message}`);
      }
    }
  }

  async checkWallet(wallet) {
    const { address } = wallet;
    const cursor = this.store.getLastSignature(address);

    // First time seeing this wallet: record the current tip, no history spam.
    if (!cursor) {
      const items = await getOutgoingTransactions(address);
      this.store.setLastSignature(address, items[0]?.hash ?? "genesis");
      console.log(`[evm-watcher] initialized cursor for ${address}`);
      return;
    }

    const items = await getOutgoingTransactions(address); // newest first
    if (!items.length) return;

    const fresh = [];
    for (const tx of items) {
      if (cursor !== "genesis" && tx.hash === cursor) break;
      fresh.push(tx);
    }
    if (!fresh.length) return;

    // Oldest first, capped.
    for (const tx of fresh.reverse().slice(-MAX_TXS_PER_TICK)) {
      const result = await detectEvmDeploy(tx);
      if (result.isDeploy) {
        console.log(
          `[evm-watcher] deploy detected by ${address}: ${result.tokens.map((t) => t.address).join(", ")}`
        );
        for (const token of result.tokens) {
          await this.onDeploy({
            chain: "robinhood",
            wallet,
            txHash: tx.hash,
            timestamp: tx.timestamp,
            token,
          });
        }
      }
    }

    this.store.setLastSignature(address, items[0].hash);
  }
}
