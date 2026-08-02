// Polls Helius for new transactions from each tracked wallet and fires
// onDeploy() for any transaction that initializes a new token mint.
//
// Cursor rule: it only ever advances past a transaction that was actually
// evaluated. A transaction we failed to read is retried on the next tick
// instead of being skipped, so a transient RPC error can't lose a launch.

import { getSignaturesForAddress, getTransaction } from "./rpc.js";
import { detectDeploy } from "./detector.js";
import { config } from "./config.js";

const GENESIS = "genesis";
const PAGE_LIMIT = 50;
const MAX_TXS_PER_TICK = 25; // rest carries over to the next tick
const MAX_PAGES = 10; // bound the catch-up scan after downtime
const MAX_ATTEMPTS = 5; // give up on a permanently unreadable tx rather than stall

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
    this.attempts = new Map(); // signature -> consecutive failures
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
    for (const wallet of this.store.listWallets("solana")) {
      try {
        await this.checkWallet(wallet);
      } catch (err) {
        this.errors++;
        console.error(`[watcher] ${wallet.address}: ${err.message}`);
      }
    }
  }

  // Every signature newer than the cursor, newest first, paginating so a
  // burst (or downtime) larger than one page isn't silently truncated.
  async collectFresh(address, cursor) {
    const collected = [];
    let before;

    for (let page = 0; page < MAX_PAGES; page++) {
      const options = { limit: PAGE_LIMIT };
      if (cursor !== GENESIS) options.until = cursor;
      if (before) options.before = before;

      const signatures = await getSignaturesForAddress(address, options);
      if (!signatures?.length) break;
      collected.push(...signatures);

      // A wallet with no history when it was added: one page is plenty.
      if (cursor === GENESIS || signatures.length < PAGE_LIMIT) break;
      before = signatures[signatures.length - 1].signature;
    }
    return collected;
  }

  async checkWallet(wallet) {
    const { address } = wallet;
    const cursor = this.store.getLastSignature(address);

    // First time seeing this wallet: record the current tip and only
    // alert on transactions that happen from now on (no history spam).
    if (!cursor) {
      const latest = await getSignaturesForAddress(address, { limit: 1 });
      this.store.setLastSignature(address, latest?.[0]?.signature ?? GENESIS);
      console.log(`[watcher] initialized cursor for ${address}`);
      return;
    }

    const fresh = await this.collectFresh(address, cursor);
    if (!fresh.length) return;

    fresh.reverse(); // oldest first, so the cursor can advance one tx at a time

    let processed = 0;
    for (const sigInfo of fresh) {
      if (processed >= MAX_TXS_PER_TICK) break; // remainder picked up next tick

      if (!sigInfo.err) {
        try {
          const tx = await getTransaction(sigInfo.signature);
          // Not yet available on this node — unknown, not "no deploy".
          if (!tx) throw new Error("transaction not available yet");

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
          this.attempts.delete(sigInfo.signature);
        } catch (err) {
          const attempts = (this.attempts.get(sigInfo.signature) ?? 0) + 1;
          this.attempts.set(sigInfo.signature, attempts);
          this.errors++;

          if (attempts < MAX_ATTEMPTS) {
            // Leave the cursor behind this tx so the next tick retries it.
            console.error(
              `[watcher] ${address}: could not evaluate ${sigInfo.signature} (attempt ${attempts}/${MAX_ATTEMPTS}): ${err.message} — retrying next tick`
            );
            return;
          }
          console.error(
            `[watcher] ${address}: giving up on ${sigInfo.signature} after ${MAX_ATTEMPTS} attempts: ${err.message}`
          );
          this.attempts.delete(sigInfo.signature);
        }
      }

      this.store.setLastSignature(address, sigInfo.signature);
      processed++;
    }
  }
}
