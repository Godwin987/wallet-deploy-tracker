import http from "node:http";
import { Store } from "./store.js";
import { Watcher } from "./watcher.js";
import { TelegramService } from "./telegram.js";

const store = new Store();

let watcher; // assigned below; TelegramService reads status lazily
const telegram = new TelegramService(store, () => ({
  startedAt: watcher?.startedAt,
  lastTickAt: watcher?.lastTickAt,
  errors: watcher?.errors ?? 0,
}));

watcher = new Watcher(store, (deploy) =>
  telegram.sendDeployAlert(deploy).catch((err) => console.error("[telegram] alert failed:", err.message))
);

watcher.start();

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
          lastPollAt: watcher.lastTickAt,
          errors: watcher.errors,
        })
      );
    })
    .listen(process.env.PORT, () => console.log(`[health] listening on port ${process.env.PORT}`));
}

console.log(`[bot] running — tracking ${store.listWallets().length} wallet(s)`);

process.on("SIGINT", () => {
  console.log("\n[bot] shutting down");
  watcher.stop();
  process.exit(0);
});
