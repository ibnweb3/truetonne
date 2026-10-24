import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { anchorReport, reconcileAnchor, LEDGER_ABI } from '../src/chain.js';
import worker from '../src/worker.js';
import { openLocal } from './d1-shim.js';

// Public, deterministic test credentials. Every chain client is stubbed; no RPC or writes.
const env = { LEDGER_ADDRESS: `0x${'12'.repeat(20)}`, ATTESTER_KEY: `0x${'0'.repeat(63)}1` };
const tx = `0x${'ab'.repeat(32)}`;
const hash = 'cd'.repeat(32);
const report = { claimant_key: 'example', claims: [{ allocation: [[1, 2.5, 100]] }] };
const pending = { status: 'pending', stage: 'submitted', tx, chain: 84532, rows_sent: 1, rows_skipped: 0 };

test('a receipt timeout preserves the submitted transaction and saves it before waiting', async () => {
  let saved;
  let sends = 0;
  const result = await anchorReport(env, report, hash, {
    walletClient: { writeContract: async () => { sends++; return tx; } },
    publicClient: {
      simulateContract: async () => ({ request: {} }),
      waitForTransactionReceipt: async () => {
        assert.equal(saved.tx, tx);
        assert.equal(saved.status, 'pending');
        throw new Error('Receipt timeout');
      },
    },
    onSubmitted: async (anchor) => { saved = anchor; },
  });
  assert.equal(sends, 1);
  assert.equal(result.status, 'pending');
  assert.equal(result.tx, tx);
  assert.equal(result.error, undefined);
  assert.equal(result.claimed, undefined);
});

test('failure to save after broadcast still returns the transaction link without broadcasting twice', async () => {
  let waits = 0;
  const result = await anchorReport(env, report, hash, {
    walletClient: { writeContract: async () => tx },
    publicClient: {
      simulateContract: async () => ({ request: {} }),
      waitForTransactionReceipt: async () => { waits++; },
    },
    onSubmitted: async () => { throw new Error('Database unavailable'); },
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.tx, tx);
  assert.ok(result.url.endsWith(tx));
  assert.equal(waits, 0);
});

test('a pending transaction reconciles accepted and blocked allocations from its actual receipt', async () => {
  const claimant = `0x${'ef'.repeat(32)}`;
  const logs = [{
    topics: encodeEventTopics({ abi: LEDGER_ABI, eventName: 'TonnesClaimed', args: { rowId: 1n, claimant, reportHash: `0x${hash}` } }),
    data: encodeAbiParameters([{ type: 'uint128' }, { type: 'uint128' }, { type: 'uint128' }], [2500n, 2500n, 100000n]),
  }, {
    topics: encodeEventTopics({ abi: LEDGER_ABI, eventName: 'DoubleClaimBlocked', args: { rowId: 2n, claimant, reportHash: `0x${hash}` } }),
    data: encodeAbiParameters([{ type: 'uint128' }, { type: 'uint128' }, { type: 'uint128' }], [5000n, 98000n, 100000n]),
  }];
  const result = await reconcileAnchor(env, pending, { publicClient: {
    getTransactionReceipt: async ({ hash: requested }) => {
      assert.equal(requested, tx);
      return { status: 'success', blockNumber: 123n, logs };
    },
  } });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.block, 123);
  assert.deepEqual(result.claimed, [{ row: 1, tonnes: 2.5 }]);
  assert.deepEqual(result.blocked, [{ row: 2, requested: 5, held_by_others: 98, cap: 100 }]);
});

test('a reverted receipt is failed, while an unavailable receipt remains pending', async () => {
  const failed = await reconcileAnchor(env, pending, { publicClient: {
    getTransactionReceipt: async () => ({ status: 'reverted', blockNumber: 124n, logs: [] }),
  } });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.claimed, []);
  const unavailable = await reconcileAnchor(env, pending, { publicClient: {
    getTransactionReceipt: async () => { throw new Error('RPC unavailable'); },
  } });
  assert.equal(unavailable.status, 'pending');
  assert.equal(unavailable.tx, tx);
});

function fixture(anchor = null, anchorTx = null) {
  const db = openLocal(':memory:');
  db.exec(readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8'));
  db.raw.prepare('INSERT INTO reports (id, created_at, report_hash, body, anchor_tx, anchor_result) VALUES (?, ?, ?, ?, ?, ?)')
    .run('abcdefghijkl', '2026-01-01', hash, JSON.stringify(report), anchorTx, anchor ? JSON.stringify(anchor) : null);
  return db;
}

test('repeated API requests return the same pending submission even when signing is unavailable', async () => {
  const db = fixture(pending, tx);
  try {
    for (let i = 0; i < 2; i++) {
      const response = await worker.fetch(new Request('https://test.local/api/report/abcdefghijkl/anchor', { method: 'POST' }), { DB: db });
      assert.equal(response.status, 202);
      const anchor = await response.json();
      assert.equal(anchor.tx, tx);
      assert.equal(anchor.status, 'pending');
      assert.equal(anchor.already, true);
    }
  } finally { db.raw.close(); }
});

test('interrupted pre-broadcast submissions show unknown status and cannot accidentally resend', async () => {
  const db = fixture({ status: 'pending', stage: 'submitting', submitted_at: '2020-01-01T00:00:00Z' });
  try {
    const response = await worker.fetch(new Request('https://test.local/api/report/abcdefghijkl/anchor', { method: 'POST' }), { DB: db });
    assert.equal(response.status, 202);
    const anchor = await response.json();
    assert.equal(anchor.status, 'pending');
    assert.equal(anchor.stage, 'unknown');
    assert.match(anchor.message, /cannot confirm/i);
    assert.equal(anchor.tx, undefined);
  } finally { db.raw.close(); }
});

test('configuration and signing errors before broadcast release the submission lock', async () => {
  for (const config of [{}, { ...env, ATTESTER_KEY: 'invalid-test-key' }]) {
    const db = fixture();
    try {
      const response = await worker.fetch(new Request('https://test.local/api/report/abcdefghijkl/anchor', { method: 'POST' }), { ...config, DB: db });
      assert.ok(response.status >= 500);
      const row = db.raw.prepare('SELECT anchor_tx, anchor_result FROM reports').get();
      assert.equal(row.anchor_tx, null);
      assert.equal(row.anchor_result, null);
    } finally { db.raw.close(); }
  }
});

test('failed and legacy confirmed API records never trigger a second submission', async () => {
  for (const anchor of [{ ...pending, status: 'failed' }, { tx, block: 123, claimed: [], blocked: [] }]) {
    const db = fixture(anchor, tx);
    try {
      const response = await worker.fetch(new Request('https://test.local/api/report/abcdefghijkl/anchor', { method: 'POST' }), { DB: db });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.status, anchor.status || 'confirmed');
      assert.equal(result.already, true);
    } finally { db.raw.close(); }
  }
});
