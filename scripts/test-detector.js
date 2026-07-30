// Verifies deploy detection against a REAL recent pump.fun token create.
// Finds a recent transaction from the pump.fun mint authority (which is
// involved in every token create) and runs it through the detector.
import { getSignaturesForAddress, getTransaction } from "../src/rpc.js";
import { detectDeploy } from "../src/detector.js";

const PUMP_MINT_AUTHORITY = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";

const sigs = await getSignaturesForAddress(PUMP_MINT_AUTHORITY, { limit: 10 });
let found = false;

for (const sigInfo of sigs) {
  if (sigInfo.err) continue;
  const tx = await getTransaction(sigInfo.signature);
  const result = detectDeploy(tx);
  if (result.isDeploy) {
    console.log("Deploy detected ✅");
    console.log("  signature:", sigInfo.signature);
    console.log("  platform: ", result.platform);
    console.log("  mint(s):  ", result.mints.join(", "));
    console.log("  deployer: ", result.signers[0]);
    found = true;
    break;
  }
}

if (!found) {
  console.error("❌ No deploy detected in the last 10 mint-authority txs — detector may be broken.");
  process.exit(1);
}

// Negative check: a plain transfer must NOT be flagged.
const negative = detectDeploy({
  meta: { err: null, innerInstructions: [] },
  transaction: {
    message: {
      accountKeys: [{ pubkey: "abc", signer: true }],
      instructions: [{ program: "system", programId: "11111111111111111111111111111111", parsed: { type: "transfer" } }],
    },
  },
});
if (negative.isDeploy) {
  console.error("❌ False positive: plain transfer flagged as deploy.");
  process.exit(1);
}
console.log("Negative case (plain transfer) correctly ignored ✅");
