// Polls Helius for new transactions from each tracked wallet and fires
// onDeploy() for any transaction that initializes a new token mint.

import { getSignaturesForAddress, getTransaction } from "./rpc.js";
import { detectDeploy } from "./detector.js";
import { config } from "./config.js";

const MAX_TXS_PER_TICK = 15; // safety cap for very active wallets

export class Watcher {
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
      if (this.running) return; // previous tick still in flight
      this.running = true;
      try {
        await this.tick();
        this.lastTickAt = new Date();
      } catch (err) {
        this.errors++;
        console.error("[watcher] tick failed:", err.message);
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(loop, config.pollIntervalMs);
    loop();
    console.log(`[watcher] started, polling every ${config.pollIntervalMs / 1000}s`);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    for (const wallet of this.store.listWallets()) {
      try {
        await this.checkWallet(wallet);
      } catch (err) {
        this.errors++;
        console.error(`[watcher] ${wallet.address}: ${err.message}`);
      }
    }
  }

  async checkWallet(wallet) {
    const { address } = wallet;
    const lastSignature = this.store.getLastSignature(address);

    // First time seeing this wallet: record the current tip and only
    // alert on transactions that happen from now on (no history spam).
    if (!lastSignature) {
      const latest = await getSignaturesForAddress(address, { limit: 1 });
      this.store.setLastSignature(address, latest?.[0]?.signature ?? "genesis");
      console.log(`[watcher] initialized cursor for ${address}`);
      return;
    }

    const options = { limit: 50 };
    if (lastSignature !== "genesis") options.until = lastSignature;
    const signatures = await getSignaturesForAddress(address, options);
    if (!signatures?.length) return;

    // Newest first from RPC — process oldest first, cap the batch.
    const newTxs = signatures
      .reverse()
      .filter((s) => !s.err)
      .slice(-MAX_TXS_PER_TICK);

    for (const sigInfo of newTxs) {
      const tx = await getTransaction(sigInfo.signature);
      const result = detectDeploy(tx);
      if (result.isDeploy && result.signers.includes(address)) {
        console.log(`[watcher] deploy detected by ${address}: ${result.mints.join(", ")}`);
        await this.onDeploy({
          wallet,
          signature: sigInfo.signature,
          blockTime: sigInfo.blockTime,
          ...result,
        });
      }
    }

    this.store.setLastSignature(address, signatures[signatures.length - 1].signature);
  }
}
