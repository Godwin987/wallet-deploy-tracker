import http from "node:http";
import { Store } from "./store.js";
import { Watcher } from "./watcher.js";
import { EvmWatcher } from "./evm-watcher.js";
import { TelegramService } from "./telegram.js";

const store = new Store();

let watcher; // assigned below; TelegramService reads status lazily
let evmWatcher;
const telegram = new TelegramService(store, () => ({
  startedAt: watcher?.startedAt,
  solana: { lastTickAt: watcher?.lastTickAt, errors: watcher?.errors ?? 0 },
  evm: { lastTickAt: evmWatcher?.lastTickAt, errors: evmWatcher?.errors ?? 0 },
}));

const onDeploy = (deploy) =>
  telegram.sendDeployAlert(deploy).catch((err) => console.error("[telegram] alert failed:", err.message));

watcher = new Watcher(store, onDeploy);
evmWatcher = new EvmWatcher(store, onDeploy);

watcher.start();
evmWatcher.start();

// Hosts like Render require web services to bind a port. Serves as a
// health-check endpoint; not started locally unless PORT is set.
if (process.env.PORT) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          wallets: store.listWallets().length,
          lastSolanaPollAt: watcher.lastTickAt,
          lastRobinhoodPollAt: evmWatcher.lastTickAt,
          errors: watcher.errors + evmWatcher.errors,
        })
      );
    })
    .listen(process.env.PORT, () => console.log(`[health] listening on port ${process.env.PORT}`));
}

console.log(`[bot] running — tracking ${store.listWallets().length} wallet(s)`);

process.on("SIGINT", () => {
  console.log("\n[bot] shutting down");
  watcher.stop();
  evmWatcher.stop();
  process.exit(0);
});
