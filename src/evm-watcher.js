// Polls Robinhood Chain (via Blockscout) for new outgoing transactions from
// each tracked EVM wallet and fires onDeploy() for token deploys.
//
// Cursor rule: it only ever advances past a transaction that was actually
// evaluated. A transaction we failed to read is retried on the next tick
// instead of being skipped, so a transient RPC error can't lose a launch.

import { getOutgoingTransactionsPage } from "./evm-rpc.js";
import { detectEvmDeploy } from "./evm-detector.js";
import { config } from "./config.js";

const GENESIS = "genesis";
const MAX_TXS_PER_TICK = 12; // each tx can cost several API calls; rest carries over
const MAX_PAGES = 10; // bound the catch-up scan after downtime (~500 txs)
const MAX_ATTEMPTS = 5; // give up on a permanently unreadable tx rather than stall

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
    this.attempts = new Map(); // txHash -> consecutive failures
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

  // Every transaction newer than the cursor, newest first, paginating so a
  // burst (or downtime) larger than one page isn't silently truncated.
  async collectFresh(address, cursor) {
    const collected = [];
    let pageParams = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const { items, nextPageParams } = await getOutgoingTransactionsPage(address, pageParams);
      if (!items.length) return collected;

      for (const tx of items) {
        if (cursor !== GENESIS && tx.hash === cursor) return collected;
        collected.push(tx);
      }

      // A wallet with no history when it was added: one page is plenty.
      if (cursor === GENESIS || !nextPageParams) return collected;
      pageParams = nextPageParams;
    }

    console.warn(`[evm-watcher] ${address}: cursor not found within ${MAX_PAGES} pages`);
    return collected;
  }

  async checkWallet(wallet) {
    const { address } = wallet;
    const cursor = this.store.getLastSignature(address);

    // First time seeing this wallet: record the current tip, no history spam.
    if (!cursor) {
      const { items } = await getOutgoingTransactionsPage(address);
      this.store.setLastSignature(address, items[0]?.hash ?? GENESIS);
      console.log(`[evm-watcher] initialized cursor for ${address}`);
      return;
    }

    const fresh = await this.collectFresh(address, cursor);
    if (!fresh.length) return;

    fresh.reverse(); // oldest first, so the cursor can advance one tx at a time

    let processed = 0;
    for (const tx of fresh) {
      if (processed >= MAX_TXS_PER_TICK) break; // remainder picked up next tick

      try {
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
        this.attempts.delete(tx.hash);
      } catch (err) {
        const attempts = (this.attempts.get(tx.hash) ?? 0) + 1;
        this.attempts.set(tx.hash, attempts);
        this.errors++;

        if (attempts < MAX_ATTEMPTS) {
          // Leave the cursor behind this tx so the next tick retries it.
          console.error(
            `[evm-watcher] ${address}: could not evaluate ${tx.hash} (attempt ${attempts}/${MAX_ATTEMPTS}): ${err.message} — retrying next tick`
          );
          return;
        }
        console.error(
          `[evm-watcher] ${address}: giving up on ${tx.hash} after ${MAX_ATTEMPTS} attempts: ${err.message}`
        );
        this.attempts.delete(tx.hash);
      }

      this.store.setLastSignature(address, tx.hash);
      processed++;
    }
  }
}
