import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { reportHash } from '../src/hash.js';

const globalNames = ['Node', 'window', 'document', 'location', 'fetch', 'navigator'];
const originalGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const nativeFetch = globalThis.fetch;
after(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

// A small DOM double exercises the production page module and its real API/hash
// helpers without a browser dependency. Layout still needs browser inspection.
class Element {
  constructor(tag, text = '') {
    this.tag = tag;
    this.text = text;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.events = {};
  }
  append(...children) {
    this.children.push(...children.map((child) => child instanceof Element ? child : new Element('#text', String(child))));
  }
  replaceChildren(...children) {
    this.text = '';
    this.children = [];
    this.append(...children);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, listener) { this.events[name] = listener; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(' '); }
  set textContent(value) { this.text = String(value); this.children = []; }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
  }
  querySelector(selector) {
    return this.find((element) => selector.startsWith('#') ? element.attributes.id === selector.slice(1) : element.tag === selector);
  }
  focus() { this.focused = true; }
  scrollIntoView() {}
}

function fixture() {
  return {
    id: 'abcdefghijkl', hash: 'not-a-valid-hash', anchor: null, ledger: null,
    chain: { can_record: false, max_rows: 80, ledger: '0x123', ledger_url: 'https://example.org/contract', explorer: 'https://example.org' },
    report: {
      claimant: 'Example Corp', aliases: ['Example Holdings'], created_at: '2026-10-24T10:00:00Z',
      dataset: { source: 'OffsetsDB', generated_at: '2026-06-01', zip_sha256: 'dataset-hash' },
      summary: { claims: 1, tonnes_claimed: 5000, tonnes_backed: 5000 },
      claims: [{
        n: 1, input: { year: 2023, vintage: 2020 },
        project: { id: 'CAR1335', name: 'Forest project', registry: 'climate-action-reserve', url: 'https://example.org/project' },
        claimed: 5000, backed: 5000, gap: 0, verdict: 'backed', flags: [], rows_total: 1,
        scope: { retired_total: 6000, top: [{ name: 'Example Corp', tonnes: 5000, retirements: 1 }] },
        rows: [{ id: 1, retired_on: '2023-01-01', vintage: 2020, used: 5000, quantity: 5000, shown_as: 'Example Corp', matched_on: 'beneficiary' }],
        allocation: [[1, 5000, 5000]],
      }],
    },
  };
}

let version = 0;
async function openReport(payload = fixture(), options = {}) {
  const main = new Element('main');
  main.attributes.id = 'main';
  const requests = [];
  const pageEvents = {};
  globalThis.Node = Element;
  globalThis.window = { addEventListener: (name, listener) => { pageEvents[name] = listener; } };
  globalThis.document = {
    title: '', querySelector: (selector) => main.querySelector(selector),
    createElement: (tag) => new Element(tag), createTextNode: (text) => new Element('#text', text),
  };
  globalThis.location = { pathname: options.path || '/r/abcdefghijkl', origin: 'https://truetonne.example' };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: options.navigator || {} });
  globalThis.fetch = async (path, init) => {
    requests.push({ path, init });
    if (options.networkError) throw new TypeError('offline');
    return { ok: !options.status || options.status < 400, status: options.status || 200, json: async () => payload };
  };
  await import(new URL(`../public/report.js?test=${++version}`, import.meta.url));
  // The page starts its request on import; wait for the complete render.
  for (let i = 0; i < 4; i++) await new Promise(setImmediate);
  return {
    main, requests, pageEvents,
    button: (text) => main.find((element) => element.tag === 'button' && element.textContent === text),
    link: (text) => main.find((element) => element.tag === 'a' && element.textContent === text),
  };
}

test('report presents actual amounts and preserves editable inputs and lookup aliases', async () => {
  const page = await openReport();
  assert.match(page.main.textContent, /5,000 t of 5,000 t claimed matched/);
  assert.match(page.main.textContent, /Vintage 2020/);
  assert.match(page.main.textContent, /Other names included in this check: Example Holdings/);
  assert.doesNotMatch(page.main.textContent, /\bnull\b|\bundefined\b|\bNaN\b/);
  assert.equal(page.main.attributes['aria-busy'], 'false');
  assert.equal(page.link('Review or change inputs').attributes.href, '/?edit=abcdefghijkl');
  const lookup = new URL(page.link('Look up this company').attributes.href, 'https://example.org');
  assert.equal(lookup.searchParams.get('name'), 'Example Corp');
  assert.deepEqual(lookup.searchParams.getAll('alias'), ['Example Holdings']);
  const download = page.link('Download full report (JSON)').attributes.href;
  assert.match(download, /^blob:/);
  page.pageEvents.pagehide({ persisted: true });
  assert.deepEqual(await (await nativeFetch(download)).json(), fixture().report);
});

test('lookup reports show found tonnes without inventing a claimed amount', async () => {
  const payload = fixture();
  payload.report.claims[0].claimed = null;
  payload.report.claims[0].verdict = 'found';
  payload.report.summary.tonnes_claimed = 0;
  payload.report.summary.tonnes_backed = 0;
  const page = await openReport(payload);
  assert.match(page.main.textContent, /5,000 t matched registry/);
  assert.match(page.main.textContent, /Amount not specified/);
  assert.doesNotMatch(page.main.textContent, /0 t of 0 t/);
});

test('account matches display both the beneficiary and retiring account for inspection', async () => {
  const payload = fixture();
  Object.assign(payload.report.claims[0].rows[0], { shown_as: 'A different beneficiary', account: 'Example Corp', matched_on: 'account' });
  const page = await openReport(payload);
  assert.match(page.main.textContent, /Beneficiary: A different beneficiary/);
  assert.match(page.main.textContent, /Retiring account: Example Corp/);
});

test('hash verification succeeds for an unchanged report and catches a mismatch', async () => {
  const payload = fixture();
  payload.hash = await reportHash(payload.report);
  let page = await openReport(payload);
  await page.button('Verify report hash').events.click();
  assert.match(page.main.textContent, /Hash matches:/);
  assert.equal(page.button('Verify report hash').disabled, false);

  payload.report.claimant = 'Changed after hashing';
  page = await openReport(payload);
  await page.button('Verify report hash').events.click();
  assert.match(page.main.textContent, /Hash does not match/);
  assert.equal(page.button('Verify report hash').disabled, false);
});

test('missing and malformed report links do not offer an ineffective retry', async () => {
  let page = await openReport({ error: 'No report with that ID.' }, { status: 404 });
  assert.match(page.main.textContent, /Report not found/);
  assert.equal(page.button('Try loading again'), undefined);
  page = await openReport(null, { path: '/report' });
  assert.equal(page.requests.length, 0);
  assert.match(page.main.textContent, /Open a saved report link/);
  assert.ok(page.link('Check a claim'));
});

test('network failures and malformed payloads are recoverable', async () => {
  const page = await openReport(null, { networkError: true });
  assert.match(page.main.textContent, /Report could not load/);
  assert.ok(page.button('Try loading again'));
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => fixture() });
  await page.button('Try loading again').events.click();
  assert.match(page.main.textContent, /Example Corp/);
  assert.equal(page.main.attributes['aria-busy'], 'false');

  const malformed = await openReport({ report: {} });
  assert.match(malformed.main.textContent, /Report could not load/);
  assert.ok(malformed.button('Try loading again'));
});

test('ambiguous project results list candidates and direct the user to an exact ID', async () => {
  const payload = fixture();
  Object.assign(payload.report.claims[0], {
    project: null, verdict: 'project_ambiguous', backed: 0, rows: [], allocation: [],
    project_lookup: { wanted: 'Forest', candidates: [{ project_id: 'CAR1', name: 'Forest One' }, { project_id: 'CAR2', name: 'Forest Two' }] },
  });
  const page = await openReport(payload);
  assert.match(page.main.textContent, /Forest One \(CAR1\)/);
  assert.match(page.main.textContent, /Forest Two \(CAR2\)/);
  assert.match(page.main.textContent, /exact project ID/);
  assert.equal(page.main.find((element) => element.className?.includes('chain-panel')), undefined);
  assert.equal(page.button('Record on test network'), undefined);
});

test('unavailable optional blockchain configuration does not create a dead feature card', async () => {
  let page = await openReport();
  assert.equal(page.main.find((element) => element.className?.includes('chain-panel')), undefined);
  assert.equal(page.button('Record on test network'), undefined);
  const payload = fixture();
  payload.chain = null;
  page = await openReport(payload);
  assert.equal(page.main.find((element) => element.className?.includes('chain-panel')), undefined);
  assert.equal(page.button('Record on test network'), undefined);
});

test('the on-chain record is open by default and stays open while pending', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  let page = await openReport(payload);
  let disclosure = page.main.find((element) => element.className?.includes('chain-panel'));
  assert.equal(disclosure.tag, 'details');
  assert.equal(disclosure.attributes.open, '');
  payload.anchor = { status: 'pending', stage: 'submitting' };
  page = await openReport(payload);
  disclosure = page.main.find((element) => element.className?.includes('chain-panel'));
  assert.equal(disclosure.attributes.open, '');
});

test('report links copy with a usable selection fallback when clipboard access fails', async () => {
  const copied = [];
  let page = await openReport(fixture(), { navigator: { clipboard: { writeText: async (value) => copied.push(value) } } });
  await page.button('Copy report link').events.click();
  assert.deepEqual(copied, ['https://truetonne.example/r/abcdefghijkl']);
  assert.match(page.main.textContent, /Report link copied/);
  page = await openReport(fixture(), { navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } } });
  await page.button('Copy report link').events.click();
  const field = page.main.querySelector('#report-link');
  assert.equal(field.attributes.value, 'https://truetonne.example/r/abcdefghijkl');
  assert.equal(field.attributes.readonly, '');
  assert.equal(field.focused, true);
  assert.match(page.main.textContent, /Select and copy the report link below/);
});

test('unknown or incomplete recording results cannot claim success or create missing transaction links', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  for (const anchor of [{}, { status: 'unexpected' }, { status: 'confirmed' }]) {
    payload.anchor = anchor;
    const page = await openReport(payload);
    assert.match(page.main.textContent, /recording status could not be read/);
    assert.doesNotMatch(page.main.textContent, /Report recorded on|testnet ledger accepted/);
    assert.equal(page.button('Record on test network'), undefined);
    assert.equal(page.main.find((element) => element.attributes.href?.includes('undefined')), undefined);
  }
  payload.anchor = { status: 'failed' };
  const page = await openReport(payload);
  assert.match(page.main.textContent, /blockchain transaction failed/);
  assert.equal(page.link('View failed transaction ↗'), undefined);
});

test('malformed chain configuration hides unconfigured actions while preserving saved evidence', async () => {
  const payload = fixture();
  payload.chain = {};
  let page = await openReport(payload);
  assert.equal(page.button('Record on test network'), undefined);
  assert.equal(page.main.find((element) => element.className?.includes('chain-panel')), undefined);
  payload.anchor = { status: 'pending', tx: '0xabc' };
  page = await openReport(payload);
  assert.match(page.main.textContent, /saved testnet record cannot be checked/);
  assert.match(page.main.textContent, /5,000 t of 5,000 t/);
  assert.equal(page.main.find((element) => element.attributes.href?.includes('undefined')), undefined);
});

test('malformed claim amounts recover instead of displaying misleading totals', async () => {
  const payload = fixture();
  payload.report.claims[0].backed = '5000';
  const page = await openReport(payload);
  assert.match(page.main.textContent, /Report could not load/);
  assert.doesNotMatch(page.main.textContent, /5,000 t of 5,000 t|NaN|undefined/);
  assert.ok(page.button('Try loading again'));
});

test('damaged optional receipts and allocations never hide valid registry results or imply accepted tonnes', async () => {
  const mutations = [
    (payload) => { payload.anchor = { status: 'confirmed', tx: '0xabc', block: 1, claimed: 'broken' }; },
    (payload) => { payload.anchor = { status: 'confirmed', tx: '0xabc', block: 1, blocked: [null] }; },
    (payload) => { payload.anchor = { status: 'confirmed', tx: '0xabc', block: 1, claimed: [{ row: 1, tonnes: '5000' }] }; },
    (payload) => { payload.anchor = { status: 'confirmed', tx: '0xabc', block: 1, claimed: [{ row: 1, tonnes: -1 }] }; },
    (payload) => { payload.ledger = { rows: 'broken' }; },
    (payload) => { payload.ledger = { rows: [null] }; },
    (payload) => { payload.ledger = { rows: [{ read_ok: true, held_by_others: '5000' }] }; },
    (payload) => { payload.report.claims[0].allocation = 'broken'; },
    (payload) => { payload.report.claims[0].allocation = [null]; },
  ];
  for (const mutate of mutations) {
    const payload = fixture();
    payload.chain.can_record = true;
    mutate(payload);
    const page = await openReport(payload);
    assert.match(page.main.textContent, /5,000 t of 5,000 t/);
    assert.match(page.main.textContent, /recording status could not be read/);
    assert.doesNotMatch(page.main.textContent, /Report could not load|Report recorded on|testnet ledger accepted|NaN|undefined/);
    assert.equal(page.button('Record on test network'), undefined);
    assert.ok(page.link('Download full report (JSON)'));
  }
});

test('an existing ledger hash record suppresses duplicate recording even without a server receipt', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  payload.ledger = { anchored_block: 123456, rows: [] };
  const page = await openReport(payload);
  assert.match(page.main.textContent, /report hash is already recorded/);
  assert.match(page.main.textContent, /accepted and blocked retirement allocations cannot be displayed/);
  assert.equal(page.button('Record on test network'), undefined);
  assert.match(page.link('block 123,456 ↗').attributes.href, /\/block\/123456$/);
});

test('large reports disclose omitted evidence and testnet rows before recording', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  payload.report.claims[0].allocation = Array.from({ length: 85 }, (_, i) => [i + 1, 1, 1]);
  payload.report.claims[0].rows_total = 85;
  const page = await openReport(payload);
  assert.match(page.main.textContent, /Only the first 80 can be submitted/);
  assert.match(page.main.textContent, /Showing 1 of 85 rows/);
  assert.match(page.main.textContent, /Current ledger availability could not be fully checked/);
  assert.ok(page.button('Record on test network'));

  globalThis.fetch = async () => ({
    ok: true, status: 200, json: async () => ({
      tx: '0xabc', url: 'https://example.org/tx', block: 1, rows_skipped: 5,
      claimed: [{ row: 1, tonnes: 5 }], blocked: [{ row: 2, requested: 1, held_by_others: 1, cap: 1 }],
    }),
  });
  await page.button('Record on test network').events.click();
  assert.match(page.main.textContent, /Some allocations were blocked/);
  assert.match(page.main.textContent, /5 backing rows were not submitted/);
  assert.match(page.main.textContent, /testnet ledger accepted 5 t/);
  assert.equal(page.button('Record on test network'), undefined);
});

test('recording failures leave the saved report intact and the action available', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  const page = await openReport(payload);
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'Recording temporarily unavailable.' }) });
  await page.button('Record on test network').events.click();
  assert.match(page.main.textContent, /Recording temporarily unavailable/);
  assert.match(page.main.textContent, /5,000 t of 5,000 t/);
  assert.equal(page.button('Record on test network').disabled, false);
});

test('submitted transaction failures offer a status check instead of a duplicate transaction', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  const page = await openReport(payload);
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: 'Confirmation took too long.', tx: '0xabc', url: 'https://example.org/tx/0xabc' }) });
  const record = page.button('Record on test network');
  await record.events.click();
  assert.equal(record.hidden, true);
  assert.equal(page.button('Check recording status').hidden, false);
  assert.equal(page.link('View submitted transaction ↗').attributes.href, 'https://example.org/tx/0xabc');
  payload.ledger = { anchored_block: 123456, rows: [] };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
  await page.button('Check recording status').events.click();
  assert.match(page.main.textContent, /report hash is already recorded/);
  assert.equal(page.button('Record on test network'), undefined);
});

test('pending receipts cannot appear as a successful record and can refresh to confirmed', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  payload.anchor = { status: 'pending', tx: '0xabc', url: 'https://example.org/tx/0xabc', rows_skipped: 0 };
  const page = await openReport(payload);
  assert.match(page.main.textContent, /confirmation is still pending/);
  assert.doesNotMatch(page.main.textContent, /Report recorded on|testnet ledger accepted/);
  assert.equal(page.button('Record on test network'), undefined);
  assert.ok(page.button('Check recording status'));
  payload.anchor = { ...payload.anchor, status: 'confirmed', block: 123456, claimed: [{ row: 1, tonnes: 5000 }], blocked: [] };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
  await page.button('Check recording status').events.click();
  assert.match(page.main.textContent, /Report recorded on/);
  assert.match(page.main.textContent, /testnet ledger accepted 5,000 t/);
  assert.equal(page.button('Check recording status'), undefined);
});

test('failed receipts show failure without successful recording or resend actions', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  payload.anchor = { status: 'failed', tx: '0xabc', url: 'https://example.org/tx/0xabc' };
  const page = await openReport(payload);
  assert.match(page.main.textContent, /blockchain transaction failed/);
  assert.doesNotMatch(page.main.textContent, /Report recorded on|testnet ledger accepted/);
  assert.equal(page.button('Record on test network'), undefined);
  assert.ok(page.link('View failed transaction ↗'));
});

test('a submission in progress suppresses resend without inventing a transaction link', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  payload.anchor = { status: 'pending', stage: 'submitting', submitted_at: '2026-10-24T10:00:00Z' };
  const page = await openReport(payload);
  assert.match(page.main.textContent, /recording request is being submitted/);
  assert.equal(page.link('View submitted transaction ↗'), undefined);
  assert.equal(page.button('Record on test network'), undefined);
  assert.ok(page.button('Check recording status'));
});

test('an interrupted submission explains recovery without pretending to be in progress forever', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  payload.anchor = { status: 'pending', stage: 'unknown', message: 'Submission was interrupted before a transaction link could be saved.' };
  const page = await openReport(payload);
  assert.match(page.main.textContent, /Submission was interrupted/);
  assert.equal(page.link('Review the inputs to create a new report').attributes.href, '/?edit=abcdefghijkl');
  assert.equal(page.button('Record on test network'), undefined);
});

test('a confirmed ledger hash takes precedence over an outdated pending submission', async () => {
  const payload = fixture();
  payload.chain.can_record = true;
  payload.anchor = { status: 'pending', stage: 'unknown' };
  payload.ledger = { anchored_block: 123456, rows: [] };
  const page = await openReport(payload);
  assert.match(page.main.textContent, /report hash is already recorded/);
  assert.doesNotMatch(page.main.textContent, /recording request is being submitted/);
  assert.equal(page.button('Record on test network'), undefined);
});

test('older reports disclose rounding shortfalls and reject unsafe registry links', async () => {
  const payload = fixture();
  Object.assign(payload.report.claims[0], { backed: 4999, gap: 1 });
  payload.report.claims[0].project.url = 'javascript:alert(1)';
  const page = await openReport(payload);
  assert.match(page.main.textContent, /older report accepted a small rounding shortfall/);
  assert.match(page.main.textContent, /1 t has no matching retirement/);
  assert.equal(page.main.find((element) => element.attributes.href?.startsWith('javascript:')), undefined);
});

test('a small quantity gap never rounds the displayed coverage up to 100 percent', async () => {
  const payload = fixture();
  Object.assign(payload.report.claims[0], { claimed: 5000, backed: 4999.999, gap: 0.001, verdict: 'partly_backed' });
  const page = await openReport(payload);
  assert.match(page.main.textContent, /0.001 t has no matching retirement/);
  assert.match(page.main.textContent, /Over 99.999% of the claimed amount/);
  assert.doesNotMatch(page.main.textContent, /100% of the claimed amount/);
  const evidence = page.main.find((element) => element.attributes.role === 'region' && element.attributes['aria-label']?.includes('Retirement evidence'));
  assert.equal(evidence.attributes.tabindex, '0');
});
