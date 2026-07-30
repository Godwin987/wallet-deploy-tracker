import { config } from "./config.js";

let requestId = 0;

async function rpcCall(method, params, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(config.heliusRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
      });
      if (res.status === 429) throw new Error("rate limited (429)");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(`RPC error: ${json.error.message}`);
      return json.result;
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

export function getSignaturesForAddress(address, options = {}) {
  return rpcCall("getSignaturesForAddress", [address, { commitment: "confirmed", ...options }]);
}

export function getTransaction(signature) {
  return rpcCall("getTransaction", [
    signature,
    { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  ]);
}

export function getHealth() {
  return rpcCall("getHealth", []);
}

// Helius DAS method — fetches token metadata (name/symbol) for a mint.
export async function getAssetMetadata(mint) {
  try {
    const result = await rpcCall("getAsset", { id: mint }, { retries: 0 });
    const meta = result?.content?.metadata;
    if (!meta) return null;
    return { name: meta.name || null, symbol: meta.symbol || null };
  } catch {
    return null; // metadata may not be indexed yet right after deploy
  }
}
