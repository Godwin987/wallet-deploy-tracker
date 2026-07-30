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

console.log(`[bot] running — tracking ${store.listWallets().length} wallet(s)`);

process.on("SIGINT", () => {
  console.log("\n[bot] shutting down");
  watcher.stop();
  process.exit(0);
});
