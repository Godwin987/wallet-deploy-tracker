// Robinhood Chain (EVM) access: JSON-RPC for eth_call, Blockscout API
// for per-wallet transaction history (plain EVM RPC can't list txs by address).

import { config } from "./config.js";

let requestId = 0;

async function ethCall(to, data) {
  const res = await fetch(config.robinhoodRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

export async function getChainId() {
  const res = await fetch(config.robinhoodRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "eth_chainId", params: [] }),
  });
  const json = await res.json();
  return json.result;
}

async function blockscout(path, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${config.robinhoodBlockscoutUrl}${path}`, {
        headers: { Accept: "application/json" },
      });
      if (res.status === 429) throw new Error("rate limited (429)");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// Outgoing transactions for a wallet, newest first (first page, 50 items).
export async function getOutgoingTransactions(address) {
  const json = await blockscout(`/addresses/${address}/transactions?filter=from`);
  return json.items ?? [];
}

// Internal transactions of a tx — where factory/launchpad contract creations show up.
export async function getInternalTransactions(txHash) {
  const json = await blockscout(`/transactions/${txHash}/internal-transactions`);
  return json.items ?? [];
}

// --- ERC-20 metadata via eth_call ---

function decodeAbiString(hex) {
  if (!hex || hex === "0x") return null;
  const data = hex.slice(2);
  try {
    if (data.length === 64) {
      // legacy bytes32 return
      return Buffer.from(data, "hex").toString("utf8").replace(/\0+$/g, "").trim() || null;
    }
    if (data.length >= 128) {
      const len = parseInt(data.slice(64, 128), 16);
      return Buffer.from(data.slice(128, 128 + len * 2), "hex").toString("utf8").trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

const SELECTORS = { name: "0x06fdde03", symbol: "0x95d89b41" };

// Returns { name, symbol } if the contract answers ERC-20 metadata calls,
// or null if it doesn't look like a token.
export async function getErc20Metadata(contractAddress) {
  const [name, symbol] = await Promise.all([
    ethCall(contractAddress, SELECTORS.name).then(decodeAbiString).catch(() => null),
    ethCall(contractAddress, SELECTORS.symbol).then(decodeAbiString).catch(() => null),
  ]);
  if (!name && !symbol) return null;
  return { name, symbol };
}
