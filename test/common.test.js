import test from 'node:test';
import assert from 'node:assert/strict';
import { api, day, registryName, n, t } from '../public/common.js';

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

test('array payloads cannot masquerade as a successful API object', async () => {
  await withFetch(async () => Response.json([]), async () => {
    await assert.rejects(api('/api/dataset'), /unreadable response/);
  });
});

test('missing or invalid totals stay readable and never render NaN or Infinity', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '5000']) {
    assert.equal(t(value), 'Not recorded');
    assert.equal(n(value), 'Not recorded');
  }
  assert.equal(t(0), '0 t');
  assert.equal(t(0.001), '0.001 t');
  assert.equal(n(5000), '5,000');
});

test('a stalled request times out instead of leaving its action pending forever', async () => {
  await withFetch((path, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), async () => {
    await assert.rejects(api('/api/company?name=Example', { timeout: 5 }), /taking too long/);
  });
});

test('cancellation while reading a response body stays a cancellation', async () => {
  const controller = new AbortController();
  await withFetch(async () => ({ ok: true, status: 200, json: async () => {
    controller.abort();
    throw new DOMException('Aborted', 'AbortError');
  } }), async () => {
    await assert.rejects(api('/api/extract', { signal: controller.signal }), /Request cancelled/);
  });
});

test('all snapshot registries have readable labels and absent dates never show Invalid Date', () => {
  assert.equal(registryName('cercarbono'), 'Cercarbono');
  assert.equal(registryName('isometric'), 'Isometric');
  assert.equal(day('not-a-date'), 'Date not recorded');
  assert.equal(day(null), 'Date not recorded');
});
