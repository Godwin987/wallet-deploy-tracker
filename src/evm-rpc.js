// Robinhood Chain (EVM) access: JSON-RPC for eth_call, Blockscout API
// for per-wallet transaction history (plain EVM RPC can't list txs by address).

import { config } from "./config.js";

let requestId = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "This contract has no name()" and "the RPC timed out" are very different
// answers: the first is final, the second means we simply don't know yet.
// Collapsing them into one silently drops launches, so they stay distinct —
// callers must retry on UndeterminedError rather than assume "not a token".
export class UndeterminedError extends Error {}
export class RevertError extends Error {}

const REVERT_RE = /revert|invalid opcode|out of gas|invalid jump|stack underflow/i;

async function ethCall(to, data, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let json;
    try {
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
      if (res.status === 429) throw new Error("rate limited (429)");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (err) {
      if (attempt >= retries) throw new UndeterminedError(`eth_call on ${to}: ${err.message}`);
      await sleep(400 * 2 ** attempt);
      continue;
    }
    if (json.error) {
      const message = String(json.error.message ?? "");
      if (REVERT_RE.test(message)) throw new RevertError(message); // definitive on-chain answer
      if (attempt >= retries) throw new UndeterminedError(`eth_call on ${to}: ${message}`);
      await sleep(400 * 2 ** attempt);
      continue;
    }
    return json.result;
  }
}

// Returns null when the contract definitively lacks the method;
// throws UndeterminedError when we couldn't find out.
async function tryCall(to, selector) {
  try {
    return await ethCall(to, selector);
  } catch (err) {
    if (err instanceof RevertError) return null;
    throw err;
  }
}

export async function getChainId({ retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(config.robinhoodRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "eth_chainId", params: [] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.result;
    } catch (err) {
      if (attempt >= retries) throw new UndeterminedError(`eth_chainId: ${err.message}`);
      await sleep(400 * 2 ** attempt);
    }
  }
}

async function blockscout(path, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${config.robinhoodBlockscoutUrl}${path}`, {
        headers: { Accept: "application/json" },
      });
      if (res.status === 429) throw new Error("rate limited (429)");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw new UndeterminedError(`blockscout ${path}: ${err.message}`);
      await sleep(400 * 2 ** attempt);
    }
  }
}

/**
 * One page of a wallet's outgoing transactions, newest first.
 * @returns {Promise<{items: object[], nextPageParams: object|null}>}
 */
export async function getOutgoingTransactionsPage(address, pageParams) {
  const qs = new URLSearchParams({ filter: "from" });
  if (pageParams) for (const [k, v] of Object.entries(pageParams)) qs.set(k, String(v));
  const json = await blockscout(`/addresses/${address}/transactions?${qs}`);
  return { items: json.items ?? [], nextPageParams: json.next_page_params ?? null };
}

export async function getOutgoingTransactions(address) {
  const { items } = await getOutgoingTransactionsPage(address);
  return items;
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

const SELECTORS = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
};

/**
 * ERC-20 metadata for a contract.
 * @returns {Promise<{name: string|null, symbol: string|null}|null>}
 *   null only when the contract is definitively not an ERC-20.
 * @throws {UndeterminedError} when the chain couldn't be reached — the caller
 *   must retry instead of concluding "not a token".
 */
export async function getErc20Metadata(contractAddress) {
  const [nameRaw, symbolRaw] = await Promise.all([
    tryCall(contractAddress, SELECTORS.name),
    tryCall(contractAddress, SELECTORS.symbol),
  ]);
  const name = decodeAbiString(nameRaw);
  const symbol = decodeAbiString(symbolRaw);
  if (name || symbol) return { name, symbol };

  // Some tokens omit name/symbol. decimals() + totalSupply() are mandatory in
  // ERC-20, so check those before writing the contract off as a non-token.
  const [decimals, totalSupply] = await Promise.all([
    tryCall(contractAddress, SELECTORS.decimals),
    tryCall(contractAddress, SELECTORS.totalSupply),
  ]);
  const hasValue = (hex) => typeof hex === "string" && hex !== "0x" && hex.length >= 66;
  if (hasValue(decimals) && hasValue(totalSupply)) return { name: null, symbol: null };

  return null;
}
