import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the real page module, shared API helper and DOM event handlers.
// This double covers state/content, not browser layout or accessibility tools.
class Element {
  constructor(tag, text = '') {
    this.tag = tag; this.text = text; this.children = []; this.attributes = {};
    this.dataset = {}; this.events = {}; this.value = ''; this.disabled = false;
  }
  append(...nodes) { this.children.push(...nodes.map((node) => node instanceof Element ? node : new Element('#text', String(node)))); }
  replaceChildren(...nodes) { this.text = ''; this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) { this.events[name] = listener; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(' '); }
  set textContent(value) { this.text = String(value); this.children = []; }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) { const found = child.find(predicate); if (found) return found; }
  }
  querySelector(selector) { return this.find((element) => selector.startsWith('#') ? element.attributes.id === selector.slice(1) : element.tag === selector); }
  focus() { this.focused = true; }
  requestSubmit() { return this.events.submit?.({ preventDefault() {} }); }
}

const globalNames = ['Node', 'document', 'location', 'history', 'fetch'];
const originalGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
after(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

function profile(name = 'Example Corp') {
  return {
    name, variants: ['example corp'], retirements: 2, tonnes: 5000, limited: false,
    dataset: { source: 'CarbonPlan OffsetsDB', generated_at: '2026-06-01' },
    matched_on: { beneficiary: 1, account: 1 },
    by_year: [{ year: '2023', tonnes: 4500 }, { year: 'unknown', tonnes: 500 }],
    top_projects: [{ id: 'CAR1335', name: 'Forest project', registry: 'climate-action-reserve', country: 'United States', tonnes: 5000 }],
  };
}

let version = 0;
async function setup({ search = '', respond = () => profile() } = {}) {
  const document = new Element('#document');
  document.createElement = (tag) => new Element(tag);
  document.createTextNode = (text) => new Element('#text', text);
  const ids = {};
  for (const [id, tag] of Object.entries({ result: 'div', msg: 'div', 'lookup-status': 'p', lookup: 'form', name: 'input', alias: 'textarea', go: 'button' })) {
    ids[id] = new Element(tag); ids[id].attributes.id = id; document.append(ids[id]);
  }
  ids.go.textContent = 'Search records';
  ids.msg.hidden = true;
  const calls = [];
  globalThis.Node = Element;
  globalThis.document = document;
  globalThis.location = { pathname: '/company.html', search };
  globalThis.history = { replaceState(_state, _title, href) {
    const url = new URL(href, 'https://example.org');
    location.pathname = url.pathname; location.search = url.search;
  } };
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    const result = await respond(path, init);
    if (result instanceof Error) throw result;
    return { ok: !result.status || result.status < 400, status: result.status || 200, json: async () => result };
  };
  await import(new URL(`../public/company.js?test=${++version}`, import.meta.url));
  for (let i = 0; i < 4; i++) await new Promise(setImmediate);
  return {
    ids, calls,
    submit: () => ids.lookup.requestSubmit(),
    respond: (next) => { respond = next; },
    link: (text) => ids.result.find((element) => element.tag === 'a' && element.textContent === text),
  };
}

test('company lookup empty results show useful guidance without fake totals or charts', async () => {
  const empty = { ...profile('No Records Company'), retirements: 0, tonnes: 0, by_year: [], top_projects: [], matched_on: {} };
  const page = await setup({ respond: () => empty });
  page.ids.name.value = empty.name;
  await page.submit();
  assert.match(page.ids.result.textContent, /No matching records found/);
  assert.match(page.ids.result.textContent, /does not prove the company has never retired credits/);
  assert.doesNotMatch(page.ids.result.textContent, /\bnull\b|\bundefined\b|\bNaN\b|Retirements by year|Projects in matching records/);
  assert.equal(page.ids.result.find((element) => element.tag === 'table'), undefined);
  assert.equal(page.ids.result.find((element) => element.attributes.class === 'bar'), undefined);
  assert.equal(page.ids.result.attributes['aria-busy'], 'false');
  assert.equal(page.ids.msg.hidden, true);
  assert.ok(page.link('Check a claim for this company'));
});

test('company lookup query preserves aliases with commas through search and claim links', async () => {
  const query = new URLSearchParams({ name: 'Example Corp' });
  query.append('alias', 'Example, Inc.');
  query.append('alias', 'Example Holdings');
  const page = await setup({ search: `?${query}` });
  assert.equal(page.ids.alias.value, 'Example, Inc.\nExample Holdings');
  assert.equal(page.calls.length, 1);
  const request = new URL(page.calls[0].path, 'https://example.org');
  assert.deepEqual(request.searchParams.getAll('alias'), ['Example, Inc.', 'Example Holdings']);
  const claim = new URL(page.link('Check a claim for this company').attributes.href, 'https://example.org');
  assert.deepEqual(claim.searchParams.getAll('alias'), ['Example, Inc.', 'Example Holdings']);
  assert.equal(claim.searchParams.get('claimant'), 'Example Corp');
  assert.match(readFileSync(new URL('../public/company.html', import.meta.url), 'utf8'), /<textarea id="alias"/);
});

test('company lookup positive results use registry values and explain attribution limits', async () => {
  const page = await setup();
  page.ids.name.value = 'Example Corp';
  await page.submit();
  assert.match(page.ids.result.textContent, /5,000 t/);
  assert.match(page.ids.result.textContent, /Forest project/);
  assert.match(page.ids.result.textContent, /Climate Action Reserve/);
  assert.match(page.ids.result.textContent, /Date not recorded/);
  assert.match(page.ids.result.textContent, /historical data, not a live registry search/);
  assert.match(page.ids.result.textContent, /Beneficiary: 1; Retiring account: 1/);
  assert.match(page.ids.result.textContent, /not proof that these credits offset/);
  assert.doesNotMatch(page.ids.result.textContent, /\bnull\b|\bundefined\b|\bNaN\b/);
  assert.equal(page.ids.result.querySelector('#results-h').focused, true);
  assert.equal(page.ids.name.disabled, false);
  assert.equal(page.ids.alias.disabled, false);
  assert.equal(page.ids.go.disabled, false);
  const permalink = page.link('Link to this lookup').attributes.href;
  assert.equal(new URL(permalink, 'https://example.org').searchParams.get('name'), 'Example Corp');
});

test('company lookup clears stale results during loading and after failure, then recovers', async () => {
  const page = await setup({ respond: () => profile('First Company') });
  page.ids.name.value = 'First Company';
  await page.submit();
  assert.match(page.ids.result.textContent, /First Company/);
  let finish;
  page.respond(() => new Promise((resolve) => { finish = resolve; }));
  page.ids.name.value = 'Second Company';
  const pending = page.submit();
  assert.equal(page.ids.result.textContent, '');
  assert.equal(page.ids.result.attributes['aria-busy'], 'true');
  assert.equal(page.ids.name.disabled, true);
  finish({ status: 503, error: 'Search service unavailable.' });
  await pending;
  assert.equal(page.ids.result.textContent, '');
  assert.match(page.ids.msg.textContent, /Search service unavailable/);
  assert.equal(page.ids.msg.hidden, false);
  assert.equal(page.ids.name.value, 'Second Company');
  assert.equal(page.ids.go.disabled, false);
  page.respond(() => profile('Second Company'));
  await page.submit();
  assert.match(page.ids.result.textContent, /Second Company/);
  assert.doesNotMatch(page.ids.result.textContent, /First Company/);
  assert.equal(page.ids.msg.hidden, true);
});

test('company lookup partial results label lower bounds and limit breakdowns honestly', async () => {
  const partial = { ...profile(), limited: true, retirements: 5000, tonnes: 123456 };
  const page = await setup({ respond: () => partial });
  page.ids.name.value = 'Example Corp';
  await page.submit();
  assert.match(page.ids.result.textContent, /At least 5,000/);
  assert.match(page.ids.result.textContent, /At least 123,456 t/);
  assert.match(page.ids.result.textContent, /partial totals/);
  assert.match(page.ids.result.textContent, /breakdowns cover only the records returned/);
});

test('company lookup validates alias count and length before making a request', async () => {
  const page = await setup();
  page.ids.name.value = 'Example Corp';
  page.ids.alias.value = 'First Name\nSecond Name\nThird Name\nFourth Name\nFifth Name';
  await page.submit();
  assert.equal(page.calls.length, 0);
  assert.match(page.ids.msg.textContent, /up to four other names/);
  assert.equal(page.ids.alias.attributes['aria-invalid'], 'true');
  assert.equal(page.ids.alias.focused, true);
  page.ids.alias.value = 'ab';
  await page.submit();
  assert.equal(page.calls.length, 0);
  assert.match(page.ids.msg.textContent, /between 3 and 120 characters/);
  page.ids.alias.value = 'a'.repeat(121);
  await page.submit();
  assert.equal(page.calls.length, 0);
  assert.match(page.ids.msg.textContent, /between 3 and 120 characters/);
  page.ids.alias.value = 'Valid, Inc.\nValid Holdings';
  await page.submit();
  assert.equal(page.calls.length, 1);
  assert.equal(page.ids.alias.attributes['aria-invalid'], undefined);
});

test('an incomplete company response never renders an undefined organisation as a result', async () => {
  const malformed = profile();
  delete malformed.name;
  const page = await setup({ respond: () => malformed });
  page.ids.name.value = 'Example Corp';
  await page.submit();
  assert.equal(page.ids.result.textContent, '');
  assert.match(page.ids.msg.textContent, /incomplete response/);
  assert.equal(page.ids.go.disabled, false);
});

test('malformed company totals and breakdowns show a recoverable error before publishing a lookup link', async () => {
  for (const malformed of [
    { ...profile(), retirements: -1 },
    { ...profile(), tonnes: -1 },
    { ...profile(), by_year: [null] },
    { ...profile(), by_year: [{ year: '2023', tonnes: 'unknown' }] },
    { ...profile(), top_projects: [{ id: 'CAR1335', tonnes: null }] },
    { ...profile(), variants: 'Example' },
    { ...profile(), dataset: null },
    { ...profile(), matched_on: { account: -1 } },
  ]) {
    const page = await setup({ respond: () => malformed });
    page.ids.name.value = 'Example Corp';
    await page.submit();
    assert.equal(page.ids.result.textContent, '');
    assert.match(page.ids.msg.textContent, /incomplete response/);
    assert.equal(page.ids.go.disabled, false);
    assert.equal(location.search, '');
  }
});
