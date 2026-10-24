import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openLocal } from './d1-shim.js';
import { validateInput, runCheck, companyProfile } from '../src/check.js';
import { vetExtraction } from '../src/extract.js';
import { chainInfo } from '../src/chain.js';
import worker from '../src/worker.js';

function fixture() {
  const db = openLocal(':memory:');
  db.exec(readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO dataset VALUES (1, 'Test registry', '2026-06-01', 'abc', 2, 1);
    INSERT INTO projects (project_id, name, registry) VALUES ('CAR1335', 'Forest North', 'climate-action-reserve'), ('CAR1336', 'Forest South', 'climate-action-reserve');
    INSERT INTO projects_fts (rowid, name, project_id) SELECT rowid, name, project_id FROM projects;
    INSERT INTO retirements (id, project_id, vintage, quantity, shown_as, account, retired_on, who)
      VALUES (1, 'CAR1335', 2020, 100, 'Example Company', 'Broker', '2023-01-01', 'Example Company Broker');
    INSERT INTO retirements_fts (rowid, who) VALUES (1, 'Example Company Broker');`);
  return db;
}

const input = (claims) => ({ claimant: 'Example Company', aliases: [], claims });
const claim = (tonnes) => ({ project_id: 'CAR1335', tonnes, vintage: null, year: null });

test('zero, malformed, excessive-precision and nonnumeric quantities cannot produce a success report', () => {
  for (const tonnes of [0, -1, true, '1,0', '1e3', 0.0001, Number.MAX_VALUE]) {
    assert.ok(validateInput(input([claim(tonnes)])).errors.length, `Rejected ${tonnes}`);
  }
  assert.equal(validateInput(input([claim('1,000.125')])).errors.length, 0);
  assert.ok(validateInput(input([null])).errors.length);
});

test('a quantity shortfall is visible even when less than half a percent', async () => {
  const db = fixture();
  try {
    const report = await runCheck(db, input([claim(100.1)]));
    assert.equal(report.claims[0].verdict, 'partly_backed');
    assert.equal(report.claims[0].gap, 0.1);
  } finally { db.raw.close(); }
});

test('the same retirement cannot back repeated claims, including unspecified quantities', async () => {
  const db = fixture();
  try {
    for (const tonnes of [100, null]) {
      const report = await runCheck(db, input([claim(tonnes), claim(tonnes)]));
      assert.equal(report.claims[1].verdict, 'used_by_earlier_claim');
      assert.equal(report.claims[1].backed, 0);
    }
  } finally { db.raw.close(); }
});

test('ambiguous project names require a project ID instead of selecting the first result', async () => {
  const db = fixture();
  try {
    const report = await runCheck(db, input([{ project_name: 'Forest', tonnes: 100 }]));
    assert.equal(report.claims[0].verdict, 'project_ambiguous');
    assert.equal(report.claims[0].project, null);
    assert.equal(report.claims[0].project_lookup.candidates.length, 2);
    assert.equal(report.claims[0].backed, 0);
  } finally { db.raw.close(); }
});

test('company lookup returns the actual snapshot metadata and no-match totals', async () => {
  const db = fixture();
  try {
    const profile = await companyProfile(db, 'Unlisted Company');
    assert.equal(profile.retirements, 0);
    assert.equal(profile.tonnes, 0);
    assert.equal(profile.dataset.source, 'Test registry');
  } finally { db.raw.close(); }
});

test('a name phrase spanning beneficiary and account fields is never attributed to the claimant', async () => {
  const db = fixture();
  try {
    // The index has the phrase "Company Broker", but no individual source field does.
    const report = await runCheck(db, { claimant: 'Company Broker', aliases: [], claims: [claim(100)] });
    assert.equal(report.claims[0].backed, 0);
    assert.equal(report.claims[0].matched_retirements, 0);
    assert.equal(report.claims[0].verdict, 'not_attributed');
  } finally { db.raw.close(); }
});

test('AI quotations must be copied from the supplied text', () => {
  const text = 'Example Company retired 100 tonnes from CAR1335.';
  const result = vetExtraction(text, { claimant: 'Example Company', claims: [{ project_id: 'CAR1335', tonnes: 100, quote: 'Certified carbon neutral.' }, null] });
  assert.equal(result.claims[0].quote, '');
  assert.ok(result.dropped.some((x) => x.includes('quoted sentence')));
});

test('a configured ledger without a signing key does not advertise recording as available', () => {
  const chain = chainInfo({ LEDGER_ADDRESS: '0x123' });
  assert.equal(chain.can_record, false);
  assert.equal(chain.max_rows, 80);
});

test('API returns actionable errors for malformed, non-object and oversized requests', async () => {
  const db = fixture();
  try {
    for (const [body, expected] of [['{', 400], ['null', 400], ['[]', 400], ['x'.repeat(32_001), 413]]) {
      const response = await worker.fetch(new Request('https://test.local/api/check', { method: 'POST', body }), { DB: db });
      assert.equal(response.status, expected);
      assert.ok((await response.json()).error.startsWith('Request'));
    }
  } finally { db.raw.close(); }
});

test('a saved report round-trips and remains available when recording is not configured', async () => {
  const db = fixture();
  try {
    const response = await worker.fetch(new Request('https://test.local/api/check', {
      method: 'POST', body: JSON.stringify(input([claim(100)])),
    }), { DB: db });
    assert.equal(response.status, 200);
    const saved = await response.json();
    const loaded = await worker.fetch(new Request(`https://test.local/api/report/${saved.id}`), { DB: db });
    const result = await loaded.json();
    assert.deepEqual(result.report, saved.report);
    assert.equal(result.hash, saved.hash);
    assert.equal(result.chain, null);
  } finally { db.raw.close(); }
});

test('missing snapshot and invalid report links return the correct status', async () => {
  const db = fixture();
  try {
    db.exec('DELETE FROM dataset');
    const dataset = await worker.fetch(new Request('https://test.local/api/dataset'), { DB: db });
    assert.equal(dataset.status, 503);
    const report = await worker.fetch(new Request('https://test.local/api/report/missing'), { DB: db });
    assert.equal(report.status, 404);
  } finally { db.raw.close(); }
});
