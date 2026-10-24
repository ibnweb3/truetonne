// On-chain part: TonneLedger on Base Sepolia. A checked report's backing rows are claimed for its claimant;
// rows another claimant already holds are refused by the contract and logged as DoubleClaimBlocked.

import { createPublicClient, createWalletClient, http, keccak256, toBytes, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

export const MAX_ANCHOR_ROWS = 80;
const EXPLORER = 'https://sepolia.basescan.org';

export const LEDGER_ABI = [
  { type: 'function', name: 'anchor', stateMutability: 'nonpayable', inputs: [
    { name: 'reportHash', type: 'bytes32' }, { name: 'claimant', type: 'bytes32' }, { name: 'rowIds', type: 'uint64[]' },
    { name: 'caps', type: 'uint128[]' }, { name: 'amounts', type: 'uint128[]' }], outputs: [] },
  { type: 'function', name: 'available', stateMutability: 'view', inputs: [{ name: 'rowId', type: 'uint64' }, { name: 'claimant', type: 'bytes32' }],
    outputs: [{ name: 'cap', type: 'uint128' }, { name: 'heldByOthers', type: 'uint128' }, { name: 'mine', type: 'uint128' }] },
  { type: 'function', name: 'anchoredAt', stateMutability: 'view', inputs: [{ name: 'reportHash', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'event', name: 'ReportAnchored', inputs: [
    { name: 'reportHash', type: 'bytes32', indexed: true }, { name: 'claimant', type: 'bytes32', indexed: true },
    { name: 'rowsClaimed', type: 'uint256' }, { name: 'rowsBlocked', type: 'uint256' }, { name: 'milliTonnes', type: 'uint256' }] },
  { type: 'event', name: 'TonnesClaimed', inputs: [
    { name: 'rowId', type: 'uint64', indexed: true }, { name: 'claimant', type: 'bytes32', indexed: true }, { name: 'reportHash', type: 'bytes32', indexed: true },
    { name: 'milliTonnes', type: 'uint128' }, { name: 'rowUsed', type: 'uint128' }, { name: 'rowCap', type: 'uint128' }] },
  { type: 'event', name: 'DoubleClaimBlocked', inputs: [
    { name: 'rowId', type: 'uint64', indexed: true }, { name: 'claimant', type: 'bytes32', indexed: true }, { name: 'reportHash', type: 'bytes32', indexed: true },
    { name: 'requested', type: 'uint128' }, { name: 'heldByOthers', type: 'uint128' }, { name: 'rowCap', type: 'uint128' }] },
];

const milli = (t) => BigInt(Math.round(t * 1000));
const tonnes = (m) => Number(m) / 1000;

export function chainInfo(env) {
  if (!env.LEDGER_ADDRESS) return null;
  return { chain_id: baseSepolia.id, name: 'Base Sepolia (testnet)', ledger: env.LEDGER_ADDRESS, explorer: EXPLORER,
    ledger_url: `${EXPLORER}/address/${env.LEDGER_ADDRESS}`, can_record: Boolean(env.ATTESTER_KEY), max_rows: MAX_ANCHOR_ROWS };
}

export const claimantId = (key) => keccak256(toBytes(key));

// Rows the report takes, merged per row across its claims, in the order they were allocated.
export function anchorRows(report) {
  const byRow = new Map();
  for (const c of report.claims) {
    for (const [id, used, cap] of c.allocation || []) {
      const cur = byRow.get(id) || { id, used: 0, cap };
      cur.used += used;
      byRow.set(id, cur);
    }
  }
  const rows = [...byRow.values()].filter((r) => r.used > 0);
  return { rows: rows.slice(0, MAX_ANCHOR_ROWS), skipped: Math.max(0, rows.length - MAX_ANCHOR_ROWS) };
}

const client = (env) => createPublicClient({ chain: baseSepolia, transport: http(env.RPC_URL || undefined, { timeout: 8000, retryCount: 0 }) });

function resultFromReceipt(submitted, receipt) {
  const base = { ...submitted, block: Number(receipt.blockNumber) };
  if (receipt.status !== 'success') {
    return { ...base, status: 'failed', message: 'The transaction was confirmed but reverted. No allocations from this transaction were recorded.', claimed: [], blocked: [] };
  }
  const logs = parseEventLogs({ abi: LEDGER_ABI, logs: receipt.logs || [] });
  return {
    ...base, status: 'confirmed', message: 'The transaction is confirmed on the test network.',
    claimed: logs.filter((l) => l.eventName === 'TonnesClaimed').map((l) => ({ row: Number(l.args.rowId), tonnes: tonnes(l.args.milliTonnes) })),
    blocked: logs.filter((l) => l.eventName === 'DoubleClaimBlocked').map((l) => ({
      row: Number(l.args.rowId), requested: tonnes(l.args.requested), held_by_others: tonnes(l.args.heldByOthers), cap: tonnes(l.args.rowCap) })),
  };
}

// A receipt timeout is not a failed transaction. Keep the submitted hash, so a later
// page load checks the same transaction instead of broadcasting another one.
export async function reconcileAnchor(env, submitted, { publicClient } = {}) {
  if (submitted?.status !== 'pending' || !submitted.tx || (!publicClient && !env.LEDGER_ADDRESS)) return submitted;
  try {
    const receipt = await (publicClient || client(env)).getTransactionReceipt({ hash: submitted.tx });
    return resultFromReceipt(submitted, receipt);
  } catch {
    return { ...submitted, message: 'This transaction has been submitted, but confirmation is not available yet. Check its status again; do not submit another transaction.' };
  }
}

export async function anchorReport(env, report, hashHex, { onSubmitted, publicClient, walletClient } = {}) {
  if (!env.LEDGER_ADDRESS || !env.ATTESTER_KEY) return { error: 'On-chain recording is not configured on this server.', status: 503 };
  let submitted;
  try {
    const account = privateKeyToAccount(env.ATTESTER_KEY);
    const wallet = walletClient || createWalletClient({ account, chain: baseSepolia, transport: http(env.RPC_URL || undefined, { timeout: 8000, retryCount: 0 }) });
    const pub = publicClient || client(env);
    const { rows, skipped } = anchorRows(report);
    const reportHash = `0x${hashHex}`;
    const claimant = claimantId(report.claimant_key);
    const args = [reportHash, claimant, rows.map((r) => BigInt(r.id)), rows.map((r) => milli(r.cap)), rows.map((r) => milli(r.used))];
    const { request } = await pub.simulateContract({ address: env.LEDGER_ADDRESS, abi: LEDGER_ABI, functionName: 'anchor', args, account });
    const tx = await wallet.writeContract(request);
    submitted = {
      status: 'pending', stage: 'submitted', submitted_at: new Date().toISOString(),
      tx, chain: baseSepolia.id, url: `${EXPLORER}/tx/${tx}`,
      rows_sent: rows.length, rows_skipped: skipped,
      message: 'Transaction submitted. Waiting for test-network confirmation.',
    };
    // Persist before waiting, including when the client disconnects during confirmation.
    await onSubmitted?.(submitted);
    const receipt = await pub.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
    return resultFromReceipt(submitted, receipt);
  } catch (e) {
    if (submitted) return { ...submitted, message: 'The transaction was submitted, but confirmation is not available yet. Check its status again; do not submit another transaction.' };
    const msg = String(e.shortMessage || e.message || e);
    if (/AlreadyAnchored/.test(msg)) return { error: 'This report is already recorded on-chain.', status: 409 };
    if (/insufficient funds/i.test(msg)) return { error: 'The demo attester wallet is out of test ETH. The report itself is saved.', status: 503 };
    return { error: 'Could not record on-chain right now. The report itself is saved.', detail: msg.slice(0, 200), status: 502 };
  }
}

// Live on-chain view of the report's rows: who already holds those tonnes, whether or not this report was anchored.
export async function ledgerStatus(env, report, row) {
  if (!env.LEDGER_ADDRESS) return null;
  const { rows } = anchorRows(report);
  const claimant = claimantId(report.claimant_key);
  const pub = client(env);
  const calls = rows.map((r) => ({ address: env.LEDGER_ADDRESS, abi: LEDGER_ABI, functionName: 'available', args: [BigInt(r.id), claimant] }));
  const [res, at] = await Promise.all([
    calls.length ? pub.multicall({ contracts: calls, allowFailure: true }) : [],
    pub.readContract({ address: env.LEDGER_ADDRESS, abi: LEDGER_ABI, functionName: 'anchoredAt', args: [`0x${row.report_hash}`] }),
  ]);
  return {
    claimant_id: claimant,
    anchored_block: Number(at) || null,
    rows: rows.map((r, i) => {
      const ok = res[i]?.status === 'success';
      const [cap, others, mine] = ok ? res[i].result : [0n, 0n, 0n];
      return { row: r.id, wants: r.used, cap: r.cap, on_chain_cap: tonnes(cap), held_by_others: tonnes(others), held_by_claimant: tonnes(mine), read_ok: ok };
    }),
  };
}
