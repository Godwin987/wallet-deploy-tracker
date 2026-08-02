// Regression tests for the missed-launch bug.
//
// A transient RPC/API failure used to be reported as "not a deploy", after
// which the cursor advanced past the transaction and the launch was lost for
// good. These tests pin the two behaviours that prevent that:
//   1. an unreadable transaction throws instead of returning "no deploy"
//   2. the cursor never advances past a transaction that wasn't evaluated
// plus the real launch this bug caused us to miss.

import { EvmWatcher } from "../src/evm-watcher.js";
import { detectEvmDeploy } from "../src/evm-detector.js";
import { getErc20Metadata, UndeterminedError } from "../src/evm-rpc.js";
import { config } from "../src/config.js";

// The launch the bot missed: wallet 0x84f8… created $HIM via a launchpad.
const WALLET = "0x84f8e5a324466deb7447048c014cf0245ce04afa";
const DEPLOY_TX = "0x6142a5b9fb4651db49bb97620050573fadb711c23d4b3c3a1c3089652d4dabed";
const HIM_TOKEN = "0xb033c50269b8a759dA2d099E2C670185E71621Fb";
const BONDING_CURVE = "0x808655f5E70606C1B0Ea0d9dcF52af54De10EaA5";

const deployTx = {
  hash: DEPLOY_TX,
  status: "ok",
  transaction_types: ["coin_transfer", "contract_call", "token_transfer"],
  to: { hash: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB" },
  created_contract: null,
};

function assert(cond, name) {
  if (!cond) {
    console.error(`❌ ${name}`);
    process.exitCode = 1;
    throw new Error(name);
  }
  console.log(`✅ ${name}`);
}

// --- 1. The launch is detected -------------------------------------------

const detected = await detectEvmDeploy(deployTx);
assert(detected.isDeploy, "missed launch is detected as a deploy");
assert(detected.tokens[0]?.address === HIM_TOKEN, "correct token contract extracted");
assert(detected.tokens[0]?.symbol === "HIM", `symbol read ($${detected.tokens[0]?.symbol})`);
assert(detected.tokens.length === 1, "bonding-curve contract excluded (only the token alerts)");

// --- 2. A reverting contract is a definitive "not a token" ----------------

assert((await getErc20Metadata(BONDING_CURVE)) === null, "reverting contract → definitively not a token");

// --- 3. Unreachable API throws instead of reporting "no deploy" -----------

const realBlockscout = config.robinhoodBlockscoutUrl;
const realRpc = config.robinhoodRpcUrl;
config.robinhoodBlockscoutUrl = "https://127.0.0.1:9/api/v2";

let threw = false;
try {
  const r = await detectEvmDeploy(deployTx);
  console.error(`   returned ${JSON.stringify(r)} instead of throwing`);
} catch (err) {
  threw = err instanceof UndeterminedError;
}
assert(threw, "unreachable API throws UndeterminedError (never a silent 'no deploy')");

// --- 4. The cursor does not advance past an unevaluated transaction -------

const state = { [WALLET]: "cursor-before-deploy" };
const wallet = { address: WALLET, label: "regression", chain: "robinhood" };
const store = {
  listWallets: (chain) => (chain === "robinhood" ? [wallet] : []),
  getLastSignature: (a) => state[a] ?? null,
  setLastSignature: (a, s) => (state[a] = s),
};

const watcher = new EvmWatcher(store, async () => {});
await watcher.tick(); // API still pointed at the black hole
assert(state[WALLET] === "cursor-before-deploy", "cursor held back while the API is unreachable");
assert(watcher.errors > 0, "failure surfaced as an error, not swallowed");

config.robinhoodBlockscoutUrl = realBlockscout;
config.robinhoodRpcUrl = realRpc;

// --- 5. Recovery: the same launch is caught once the API is back ----------

const { getOutgoingTransactionsPage } = await import("../src/evm-rpc.js");
const { items } = await getOutgoingTransactionsPage(WALLET);
let all = items;
let pageParams = (await getOutgoingTransactionsPage(WALLET)).nextPageParams;
while (pageParams && !all.some((t) => t.hash === DEPLOY_TX)) {
  const page = await getOutgoingTransactionsPage(WALLET, pageParams);
  all = all.concat(page.items);
  pageParams = page.nextPageParams;
}
const deployIndex = all.findIndex((t) => t.hash === DEPLOY_TX);
assert(deployIndex >= 0, "found the deploy in the wallet's history");

// Rewind the cursor to the transaction immediately before the launch.
state[WALLET] = all[deployIndex + 1].hash;

const alerts = [];
const recoveryWatcher = new EvmWatcher(store, async (p) => alerts.push(p));
await recoveryWatcher.tick();

const himAlert = alerts.find((a) => a.token.address === HIM_TOKEN);
assert(!!himAlert, "watcher re-detects the launch it previously missed");
assert(himAlert.token.symbol === "HIM", `alert carries the token ($${himAlert?.token.symbol})`);
assert(state[WALLET] !== all[deployIndex + 1].hash, "cursor advanced after successful processing");

console.log("\nResilience OK ✅");
