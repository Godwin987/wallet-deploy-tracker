// Verifies the alert buttons: correct deep-link shapes per chain, and that a
// malformed address is dropped rather than rendered as a dead button.
import { buildAlertKeyboard, rickScanUrl, rickDevUrl, basedUrl, isValidStartPayload } from "../src/links.js";

function assert(cond, name) {
  if (!cond) {
    console.error(`❌ ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ ${name}`);
}

const SOL_MINT = "4dbzPnjU5jfmHyKunEKpcBCqa1Uv7jXwbWxN3zHapump";
const SOL_WALLET = "7HrbKX8Dygk8wmBYnSAKhf6sd4R5TRGQtMmuGmTdc2g";
const EVM_TOKEN = "0xb033c50269b8a759dA2d099E2C670185E71621Fb";
const EVM_WALLET = "0x84f8e5a324466deb7447048c014cf0245ce04afa";

// Telegram start-payload rules
assert(isValidStartPayload(SOL_MINT), "solana mint is a valid start payload");
assert(isValidStartPayload(EVM_TOKEN), "evm address is a valid start payload");
assert(isValidStartPayload(`dev-${SOL_WALLET}`), "dev- prefixed payload fits the 64-char limit");
assert(!isValidStartPayload("bad address!"), "malformed payload rejected");

// Deep-link shapes (Rick's documented formats)
assert(rickScanUrl(SOL_MINT) === `https://t.me/RickBurpBot?start=${SOL_MINT}`, "rick scan link");
assert(rickDevUrl(SOL_WALLET) === `https://t.me/RickBurpBot?start=dev-${SOL_WALLET}`, "rick dev-history link");
assert(basedUrl(SOL_MINT) === `https://t.me/based_eth_bot?start=${SOL_MINT}`, "based trade link");
assert(rickScanUrl("nope!") === null, "malformed address yields no button (not a dead link)");

// Solana keyboard, pump.fun launch
const sol = buildAlertKeyboard({
  chain: "solana",
  contract: SOL_MINT,
  walletAddress: SOL_WALLET,
  txHash: "5xTest",
  platform: "pump.fun",
});
const solUrls = sol.inline_keyboard.flat().map((b) => b.url);
assert(sol.inline_keyboard[0].length === 2, "trade + scan sit on the top row");
assert(solUrls.some((u) => u.includes("based_eth_bot")), "Based button present");
assert(solUrls.some((u) => u === `https://t.me/RickBurpBot?start=${SOL_MINT}`), "Rick button present");
assert(solUrls.some((u) => u === `https://dexscreener.com/solana/${SOL_MINT}`), "solana chart link");
assert(solUrls.some((u) => u === `https://solscan.io/token/${SOL_MINT}`), "solscan token link");
assert(solUrls.some((u) => u.includes("pump.fun/coin/")), "pump.fun button on pump.fun launches");

// Non-pump.fun launch drops the pump.fun button
const direct = buildAlertKeyboard({
  chain: "solana",
  contract: SOL_MINT,
  walletAddress: SOL_WALLET,
  txHash: "5xTest",
  platform: "Direct SPL token",
});
assert(
  !direct.inline_keyboard.flat().some((b) => b.url.includes("pump.fun")),
  "no pump.fun button for non-pump.fun launches"
);

// Robinhood keyboard
const evm = buildAlertKeyboard({
  chain: "robinhood",
  contract: EVM_TOKEN,
  walletAddress: EVM_WALLET,
  txHash: "0xabc",
});
const evmUrls = evm.inline_keyboard.flat().map((b) => b.url);
assert(evmUrls.some((u) => u === `https://dexscreener.com/robinhood/${EVM_TOKEN}`), "robinhood chart link");
assert(
  evmUrls.some((u) => u === `https://robinhoodchain.blockscout.com/token/${EVM_TOKEN}`),
  "robinhood explorer link"
);
assert(evmUrls.some((u) => u.includes("based_eth_bot")), "Based button on robinhood alerts too");
assert(evmUrls.every((u) => u.startsWith("https://")), "every button is a valid https url");

console.log("\nLinks OK ✅");
