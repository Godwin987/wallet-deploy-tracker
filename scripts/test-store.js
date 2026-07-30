// Verifies wallet add/remove/persistence logic used by the /add and
// /remove Telegram commands. Restores data files when done.
import fs from "node:fs";
import path from "node:path";
import { Store } from "../src/store.js";
import { config } from "../src/config.js";

const walletsFile = path.join(config.dataDir, "wallets.json");
const backup = fs.existsSync(walletsFile) ? fs.readFileSync(walletsFile, "utf8") : null;

function assert(cond, name) {
  if (!cond) {
    console.error(`❌ ${name}`);
    process.exit(1);
  }
  console.log(`✅ ${name}`);
}

try {
  const store = new Store();
  const addr = "7HrbKX8Dygk8wmBYnSAKhf6sd4R5TRGQtMmuGmTdc2g";

  assert(store.addWallet(addr, "test dev").ok, "add valid wallet");
  assert(!store.addWallet(addr).ok, "reject duplicate wallet");
  assert(!store.addWallet("not-a-real-address!!").ok, "reject invalid address");
  assert(store.getWallet(addr)?.label === "test dev", "label persisted");

  const reloaded = new Store();
  assert(reloaded.getWallet(addr) != null, "wallet survives restart (persisted to disk)");

  assert(reloaded.removeWallet(addr).ok, "remove wallet");
  assert(!reloaded.removeWallet(addr).ok, "reject removing unknown wallet");
  assert(new Store().listWallets().length === 0, "removal persisted");

  console.log("Store OK ✅");
} finally {
  if (backup !== null) fs.writeFileSync(walletsFile, backup);
}
