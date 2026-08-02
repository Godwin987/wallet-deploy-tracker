// Detects whether a Blockscout transaction is a token deploy on Robinhood Chain.
//
// Two paths:
//  1. Direct deploy — the tx itself creates a contract (to == null /
//     created_contract set / type "contract_creation").
//  2. Factory deploy — the wallet calls a launchpad/factory contract that
//     creates the token via an internal create/create2.
//
// Every created contract is then probed with ERC-20 metadata calls — only
// contracts that answer are treated as token deploys.
//
// Any RPC/API failure throws (UndeterminedError) rather than returning
// "not a deploy", so the watcher can retry instead of skipping the launch.

import { getInternalTransactions, getErc20Metadata } from "./evm-rpc.js";

const CREATE_TYPES = new Set(["create", "create2", "create3"]);

function txTypes(tx) {
  return tx.transaction_types ?? tx.tx_types ?? [];
}

/**
 * @param {object} tx  Transaction item from the Blockscout API
 * @returns {Promise<{ isDeploy: boolean, tokens: {address: string, name: string|null, symbol: string|null}[] }>}
 */
export async function detectEvmDeploy(tx) {
  const none = { isDeploy: false, tokens: [] };
  if (tx.status !== "ok") return none;

  const created = [];

  // Path 1: direct contract creation
  const direct = tx.created_contract?.hash;
  if (direct) created.push(direct);
  const isCreation = txTypes(tx).includes("contract_creation") || tx.to == null;

  // Path 2: contract call that may create contracts internally.
  // Failures here propagate on purpose — swallowing them would report
  // "no deploy" for a launch we simply failed to read.
  if (!direct && (txTypes(tx).includes("contract_call") || isCreation)) {
    const internals = await getInternalTransactions(tx.hash);
    for (const it of internals) {
      const address = it.created_contract?.hash;
      if (address && CREATE_TYPES.has(it.type) && !created.includes(address)) {
        created.push(address);
      }
    }
  }
  if (created.length === 0) return none;

  const tokens = [];
  for (const address of created) {
    const meta = await getErc20Metadata(address);
    if (meta) tokens.push({ address, ...meta });
  }
  if (tokens.length === 0) return none; // contracts were deployed, but none are tokens

  return { isDeploy: true, tokens };
}
