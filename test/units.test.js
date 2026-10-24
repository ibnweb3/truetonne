import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectId, projectIdsIn, normalizeName } from '../src/names.js';
import { canonical, reportHash } from '../src/hash.js';
import { vetExtraction, numbersIn } from '../src/extract.js';

test('project IDs normalise across written forms', () => {
  assert.equal(normalizeProjectId('VCS 1842'), 'VCS1842');
  assert.equal(normalizeProjectId('CAR 1480'), 'CAR1480');
});

test('legal suffixes are ignored in names', () => {
  assert.equal(normalizeName('Kinaxis Inc.'), normalizeName('Kinaxis'));
});

test('canonical JSON is key-order independent and hashes are stable', async () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.equal(await reportHash({ a: 1, b: 2 }), await reportHash({ b: 2, a: 1 }));
});

test('numbers written as "1.2 million" are recognised', () => {
  assert.ok(numbersIn('retired 1.2 million tonnes').has(1200000));
});

test('vetting drops project IDs, tonnes and years not in the text', () => {
  const text = 'In 2022 Spotify retired 95,000 tonnes from CAR 1480.';
  const out = vetExtraction(text, { claimant: 'Spotify', claims: [
    { project_id: 'CAR1480', project_name: '', vintage: 0, tonnes: 95000, year: 2022, quote: '' },
    { project_id: 'VCS9999', project_name: '', vintage: 0, tonnes: 12345, year: 2019, quote: '' }] });
  assert.equal(out.claimant, 'Spotify');
  assert.equal(out.claims[0].project_id, 'CAR1480');
  assert.equal(out.claims[0].tonnes, 95000);
  assert.equal(out.claims[1]?.project_id ?? '', '');
  assert.ok(out.dropped.length >= 3);
});
