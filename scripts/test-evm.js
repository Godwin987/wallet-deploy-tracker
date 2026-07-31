// Verifies Robinhood Chain support: RPC connectivity, deploy detection on a
// real factory-created token (internal create2 + ERC-20 metadata probe), and
// chain-aware wallet storage.
import { getChainId } from "../src/evm-rpc.js";
import { detectEvmDeploy } from "../src/evm-detector.js";
import { detectChain } from "../src/store.js";

function assert(cond, name) {
  if (!cond) {
    console.error(`❌ ${name}`);
    process.exit(1);
  }
  console.log(`✅ ${name}`);
}

// 1. RPC connectivity + right chain
const chainId = await getChainId();
assert(chainId === "0x1237", `RPC reachable, chain id 4663 (got ${chainId})`);

// 2. Real deploy: bridge factory create2-deployed the 1INCH token in this tx.
const KNOWN_DEPLOY_TX = "0x8156dd6cf208a588e0d9e0b2edb81c627983e741e712b958b286554679905ce9";
const KNOWN_TOKEN = "0x1755C2910c126eE1b0CF1E08a307Dc9E787285a0";

const result = await detectEvmDeploy({
  hash: KNOWN_DEPLOY_TX,
  status: "ok",
  transaction_types: ["contract_call", "token_transfer"],
  to: { hash: "0xfd9b17206278C16DdaacF6AC8f05dBf97EdCb31e" },
  created_contract: null,
});
assert(result.isDeploy, "factory deploy detected via internal create2");
assert(result.tokens[0]?.address === KNOWN_TOKEN, "created token address extracted");
assert(!!result.tokens[0]?.name, `ERC-20 metadata read (${result.tokens[0]?.name} / ${result.tokens[0]?.symbol})`);

// 3. Negative: plain transfers must not be flagged (and cost no API calls).
const negative = await detectEvmDeploy({
  hash: "0x" + "0".repeat(64),
  status: "ok",
  transaction_types: ["coin_transfer"],
  to: { hash: "0x" + "1".repeat(40) },
  created_contract: null,
});
assert(!negative.isDeploy, "plain transfer correctly ignored");

// 4. Chain auto-detection from address format
assert(detectChain("0x96111CC4867C5e1c22dA4b79BB8852b9E2A07eB1") === "robinhood", "EVM address → robinhood");
assert(detectChain("7HrbKX8Dygk8wmBYnSAKhf6sd4R5TRGQtMmuGmTdc2g") === "solana", "base58 address → solana");
assert(detectChain("hello world") === null, "garbage rejected");

console.log("EVM support OK ✅");
