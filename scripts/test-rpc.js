// Verifies Helius RPC connectivity.
import { getHealth, getSignaturesForAddress } from "../src/rpc.js";

const health = await getHealth();
console.log("getHealth:", health);

// Pump.fun mint authority — involved in every pump.fun token create.
const sigs = await getSignaturesForAddress("TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM", { limit: 3 });
console.log(`getSignaturesForAddress: got ${sigs.length} signatures, latest:`, sigs[0]?.signature);
console.log("RPC OK ✅");
