import test from 'node:test';
import assert from 'node:assert/strict';
import { api, day, registryName } from '../public/common.js';

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('API preserves server status and validation messages for page recovery', async () => {
  await withFetch(async () => Response.json({ error: 'Check the amount.', errors: ['Use positive tonnes.'] }, { status: 400 }), async () => {
    await assert.rejects(api('/api/check'), (error) => error.status === 400 && error.message === 'Check the amount.' && error.data.errors[0] === 'Use positive tonnes.');
  });
});

test('unreadable success and HTML service failures never become fake successful states', async () => {
  for (const status of [200, 503]) {
    await withFetch(async () => new Response('<html>Service unavailable</html>', { status }), async () => {
      await assert.rejects(api('/api/dataset'), /unreadable response|temporarily unavailable/);
    });
  }
});

test('failed connections have an actionable consumer message', async () => {
  await withFetch(async () => { throw new TypeError('Failed to fetch'); }, async () => {
    await assert.rejects(api('/api/check'), /Check your internet connection/);
  });
});

test('a stalled request times out instead of leaving its action pending forever', async () => {
  await withFetch((path, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), async () => {
    await assert.rejects(api('/api/company?name=Example', { timeout: 5 }), /taking too long/);
  });
});

test('all snapshot registries have readable labels and absent dates never show Invalid Date', () => {
  assert.equal(registryName('cercarbono'), 'Cercarbono');
  assert.equal(registryName('isometric'), 'Isometric');
  assert.equal(day('not-a-date'), 'Date not recorded');
  assert.equal(day(null), 'Date not recorded');
});
