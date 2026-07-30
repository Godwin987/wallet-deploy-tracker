// Detects whether a parsed transaction is a new token deploy.
//
// A deploy is any transaction that initializes a new SPL token mint
// (initializeMint / initializeMint2 on the token programs), which covers
// direct SPL deploys as well as launchpads that create the mint via CPI
// (pump.fun, letsbonk / Raydium LaunchLab, Moonshot, ...).

const LAUNCHPADS = {
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "pump.fun",
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: "letsbonk (Raydium LaunchLab)",
  MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG: "Moonshot",
};

const TOKEN_PROGRAMS = new Set(["spl-token", "spl-token-2022"]);
const MINT_INIT_TYPES = new Set(["initializeMint", "initializeMint2"]);

function allInstructions(tx) {
  const outer = tx.transaction?.message?.instructions ?? [];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions);
  return [...outer, ...inner];
}

/**
 * @param {object} tx  Parsed transaction from getTransaction (jsonParsed)
 * @returns {{ isDeploy: boolean, mints: string[], platform: string, signers: string[] }}
 */
export function detectDeploy(tx) {
  const none = { isDeploy: false, mints: [], platform: "", signers: [] };
  if (!tx || tx.meta?.err) return none;

  const instructions = allInstructions(tx);

  const mints = [];
  for (const ix of instructions) {
    if (TOKEN_PROGRAMS.has(ix.program) && MINT_INIT_TYPES.has(ix.parsed?.type)) {
      const mint = ix.parsed?.info?.mint;
      if (mint && !mints.includes(mint)) mints.push(mint);
    }
  }
  if (mints.length === 0) return none;

  let platform = "Direct SPL token";
  for (const ix of instructions) {
    const name = LAUNCHPADS[ix.programId];
    if (name) {
      platform = name;
      break;
    }
  }

  const signers = (tx.transaction?.message?.accountKeys ?? [])
    .filter((k) => k.signer)
    .map((k) => k.pubkey);

  return { isDeploy: true, mints, platform, signers };
}
