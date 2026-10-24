import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// A small DOM double exercises the real entry-page module and shared API helper
// without a browser or service credentials. It does not test visual layout.
class Element {
  constructor(tag = '#text', text = '') { this.tagName = tag; this.nodes = []; this.attrs = {}; this.events = {}; this._text = text; this.value = ''; this.dataset = {}; }
  get children() { return this.nodes.filter((node) => node.tagName !== '#text'); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { const list = this.parentElement?.children || []; return list[list.indexOf(this) + 1] || null; }
  get previousElementSibling() { const list = this.parentElement?.children || []; return list[list.indexOf(this) - 1] || null; }
  get textContent() { return this.tagName === '#text' ? this._text : this.nodes.map((node) => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  get className() { return this.attrs.class || ''; }
  set className(value) { this.attrs.class = value; }
  setAttribute(key, value) {
    this.attrs[key] = String(value);
    if (key === 'name') this.name = String(value);
    if (key === 'value') this.value = String(value);
    if (key === 'disabled') this.disabled = true;
    if (key === 'hidden') this.hidden = true;
  }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  append(...nodes) {
    for (let node of nodes) {
      if (!(node instanceof Element)) node = new Element('#text', String(node));
      node.parentElement = this;
      this.nodes.push(node);
    }
  }
  replaceChildren(...nodes) { this.nodes = []; this.append(...nodes); }
  remove() { this.parentElement.nodes = this.parentElement.nodes.filter((node) => node !== this); }
  addEventListener(name, handler) { (this.events[name] ||= []).push(handler); }
  async trigger(name, extra = {}) { for (const handler of this.events[name] || []) await handler({ preventDefault() {}, ...extra }); }
  async click() { if (!this.disabled) await this.trigger('click'); }
  focus() { this.owner.activeElement = this; }
  scrollIntoView() {}
  querySelectorAll(selector) {
    const matchSimple = (element, simple) => {
      const attr = simple.match(/\[([^=\]]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/);
      if (attr) {
        if (!(attr[1] in element.attrs)) return false;
        const expected = attr[2] ?? attr[3] ?? attr[4];
        if (expected !== undefined && element.attrs[attr[1]] !== expected) return false;
        simple = simple.replace(attr[0], '');
      }
      if (!simple) return true;
      if (simple.startsWith('#')) return element.attrs.id === simple.slice(1);
      if (simple.startsWith('.')) return element.className.split(/\s+/).includes(simple.slice(1));
      return element.tagName === simple.toLowerCase();
    };
    const matches = (element, group) => {
      const parts = group.trim().split(/\s+(?=[^\]]*(?:\[|$))/);
      if (!matchSimple(element, parts.pop())) return false;
      for (const part of parts.reverse()) {
        let ancestor = element.parentElement;
        while (ancestor && !matchSimple(ancestor, part)) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        element = ancestor;
      }
      return true;
    };
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (selector.split(',').some((group) => matches(child, group))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function documentFrom(html) {
  const document = new Element('#document');
  document.createElement = (tag) => { const element = new Element(tag); element.owner = document; return element; };
  document.createTextNode = (text) => new Element('#text', text);
  let current = document;
  for (const token of html.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) || []) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) { current = current.parentElement || document; continue; }
    if (token.startsWith('<')) {
      const tag = token.match(/^<([\w-]+)/)?.[1];
      if (!tag) continue;
      const element = document.createElement(tag.toLowerCase());
      for (const attr of token.slice(tag.length + 1, -1).matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/g)) {
        element.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '');
      }
      current.append(element);
      if (!['meta', 'link', 'input', 'br', 'hr', 'img', 'path', 'rect'].includes(tag) && !token.endsWith('/>')) current = element;
    } else current.append(token);
  }
  return document;
}

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const common = readFileSync(new URL('../public/common.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/^import .*$/m, '');
const dataset = { source: 'CarbonPlan OffsetsDB', generated_at: '2026-06-01', retirements: 495403 };
const DRAFT_KEY = 'truetonne.claim-draft.v1';
const sourceText = 'In 2022 Spotify retired 95000 tonnes from CAR1480, vintage 2021.';

async function setup({ search = '', draft = null, responses = {} } = {}) {
  const document = documentFrom(html);
  const storage = new Map(draft ? [[DRAFT_KEY, JSON.stringify(draft)]] : []);
  const calls = [];
  const window = { events: {}, addEventListener(name, handler) { (this.events[name] ||= []).push(handler); } };
  const location = { search, assign(path) { this.assigned = path; } };
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({ document, Node: Element, window, location, URLSearchParams, AbortController, TextEncoder, crypto,
    setTimeout(handler, delay) { const id = ++timerId; timers.set(id, { handler, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (path, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, body });
      let result = responses[path] ?? (path === '/api/dataset' ? { dataset } : undefined);
      if (result instanceof Error) throw result;
      if (typeof result === 'function') result = result(body);
      result ||= { id: 'ABCDEFGHIJKL' };
      return { ok: !result.status || result.status < 400, status: result.status || 200, json: async () => result };
    },
  });
  vm.runInContext(common, context, { filename: 'common.js' });
  vm.runInContext(app, context, { filename: 'app.js' });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const flushDraft = () => { for (const [id, timer] of timers) if (timer.delay <= 200) { timers.delete(id); timer.handler(); } };
  return { document, calls, location, storage, window, flushDraft, $: (selector) => document.querySelector(selector) };
}

test('registry example creates a report with the reviewed values', async () => {
  const state = await setup();
  assert.equal(state.$('#check-btn').disabled, false);
  await state.$('.sample').click();
  assert.equal(state.$('#claimant').value, 'Spotify');
  assert.equal(state.$('[name=tonnes]').value, '95000');
  await state.$('#check-form').trigger('submit');
  assert.equal(state.location.assigned, '/r/ABCDEFGHIJKL');
  assert.equal(state.calls.find((call) => call.path === '/api/check').body.claims[0].project_id, 'CAR1480');
});

test('failed report creation preserves inputs and allows correction', async () => {
  const state = await setup({ responses: { '/api/check': { status: 503, error: 'Temporarily unavailable' } } });
  await state.$('.sample').click();
  await state.$('#check-form').trigger('submit');
  assert.match(state.$('#check-msg').textContent, /Temporarily unavailable/);
  assert.equal(state.$('#claimant').value, 'Spotify');
  assert.equal(state.$('#check-btn').disabled, false);
  assert.equal(state.$('[name=project]').disabled, false);
  state.$('[name=tonnes]').value = '0';
  await state.$('#check-form').trigger('submit');
  assert.match(state.$('#check-msg').textContent, /greater than zero/);
  assert.equal(state.$('#check-msg').className, 'note bad');
});

test('session drafts restore inputs, source text and company names containing commas', async () => {
  const state = await setup({ draft: { claimant: 'Draft Co', aliases: ['Draft Co, Inc.'], claims: [{ project_id: 'CAR1480', tonnes: '90000' }], source_text: sourceText, paste: sourceText, tab: 1 } });
  assert.equal(state.$('#claimant').value, 'Draft Co');
  assert.equal(state.$('#aliases').value, 'Draft Co, Inc.');
  assert.equal(state.$('[name=tonnes]').value, '90000');
  assert.equal(state.$('#pane-form').hidden, false);
  assert.equal(state.$('#source-preview-text').textContent, sourceText);
  state.$('[name=tonnes]').value = '12345';
  await state.$('#check-form').trigger('input');
  state.flushDraft();
  assert.equal(JSON.parse(state.storage.get(DRAFT_KEY)).claims[0].tonnes, '12345');
});

test('reviewing a report restores its original inputs and unlocks the form', async () => {
  const state = await setup({ search: '?edit=ABCDEFGHIJKL', responses: { '/api/report/ABCDEFGHIJKL': { report: { claimant: 'Kinaxis', aliases: ['Kinaxis Inc.'], claims: [{ input: { project_id: 'CAR1335', vintage: 2025, year: 2025, tonnes: 5000 } }], source_text: sourceText } } } });
  assert.equal(state.$('#claimant').value, 'Kinaxis');
  assert.equal(state.$('[name=project]').value, 'CAR1335');
  assert.equal(state.$('#check-btn').disabled, false);
  assert.match(state.$('#form-notice').textContent, /Changes create a new report/);
});

test('company lookup links preserve the company and its aliases', async () => {
  const state = await setup({ search: '?claimant=Delta%20Air%20Lines&alias=Delta%20Air%20Lines%2C%20Inc.' });
  assert.equal(state.$('#claimant').value, 'Delta Air Lines');
  assert.equal(state.$('#aliases').value, 'Delta Air Lines, Inc.');
  assert.equal(state.$('#pane-form').hidden, false);
});

test('empty pasted text is rejected before calling AI', async () => {
  const state = await setup();
  await state.$('#paste-form').trigger('submit');
  assert.equal(state.calls.some((call) => call.path === '/api/extract'), false);
  assert.match(state.$('#extract-msg').textContent, /Paste at least/);
});

for (const [name, response, message] of [
  ['AI failure', { status: 502, error: 'AI unavailable' }, /AI unavailable/],
  ['no extracted claims', { claims: [], dropped: [] }, /No usable carbon-credit details/],
]) test(`${name} offers manual entry and preserves the pasted source`, async () => {
  const state = await setup({ responses: { '/api/extract': response } });
  state.$('#paste').value = sourceText;
  await state.$('#paste-form').trigger('submit');
  assert.match(state.$('#extract-msg').textContent, message);
  assert.equal(state.$('#extract-btn').disabled, false);
  await state.$('#extract-msg').querySelector('button').click();
  assert.equal(state.$('#pane-form').hidden, false);
  assert.equal(state.$('#source-text').value, sourceText);
  assert.equal(state.$('#source-preview-text').textContent, sourceText);
});

test('AI suggestions are reviewed before any registry check', async () => {
  const state = await setup({ responses: { '/api/extract': { claimant: 'Spotify', claims: [{ project_id: 'CAR1480', vintage: 2021, year: 2022, tonnes: 95000 }], dropped: ['invented project was removed'] } } });
  state.$('#paste').value = sourceText;
  await state.$('#paste-form').trigger('submit');
  assert.equal(state.$('#pane-form').hidden, false);
  assert.equal(state.$('[name=tonnes]').value, '95000');
  assert.match(state.$('#review-note').textContent, /invented project was removed/);
  assert.equal(state.calls.some((call) => call.path === '/api/check'), false);
});

test('claim row limit and removal keep controls and accessible labels in sync', async () => {
  const state = await setup();
  for (let i = 0; i < 15; i++) await state.$('#add-row').click();
  assert.equal(state.$('#claim-rows').children.length, 12);
  assert.equal(state.$('#add-row').disabled, true);
  await state.$('#claim-rows').firstElementChild.querySelector('button').click();
  assert.equal(state.$('#claim-rows').children.length, 11);
  assert.equal(state.$('#add-row').disabled, false);
  assert.equal(state.$('[name=project]').getAttribute('aria-label'), 'Claim 1: project ID or name');
});

test('unavailable registry data prevents report creation and offers a working retry', async () => {
  let attempts = 0;
  const state = await setup({ responses: { '/api/dataset': () => ++attempts === 1 ? { status: 503, error: 'Snapshot unavailable' } : { dataset } } });
  assert.equal(state.$('#check-btn').disabled, true);
  assert.equal(state.$('#dataset-retry').hidden, false);
  assert.match(state.$('#stamp').textContent, /Registry data is unavailable/);
  await state.$('#dataset-retry').click();
  assert.equal(state.$('#check-btn').disabled, false);
  assert.equal(state.$('#dataset-retry').hidden, true);
});

test('missing edit reports preserve an existing draft and release controls', async () => {
  const state = await setup({ search: '?edit=ABCDEFGHIJKL', draft: { claimant: 'Keep my input', claims: [{ project_id: 'CAR1480', tonnes: '123' }], tab: 1 }, responses: { '/api/report/ABCDEFGHIJKL': { status: 404, error: 'Report not found' } } });
  assert.equal(state.$('#claimant').value, 'Keep my input');
  assert.match(state.$('#form-notice').textContent, /Report not found/);
  assert.equal(state.$('#check-btn').disabled, false);
});

test('returning from a report re-enables the form without losing its inputs', async () => {
  const state = await setup();
  await state.$('.sample').click();
  await state.$('#check-form').trigger('submit');
  assert.equal(state.$('#check-btn').disabled, true);
  for (const callback of state.window.events.pageshow || []) callback({ persisted: true });
  assert.equal(state.$('#check-btn').disabled, false);
  assert.equal(state.$('#check-btn').textContent, 'Create a report');
  assert.equal(state.$('#claimant').value, 'Spotify');
});

test('example amounts and dates agree with the local registry snapshot when available', async (t) => {
  const directory = new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url);
  let file;
  try { file = readdirSync(directory).find((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite'); } catch { /* A fresh checkout has no local snapshot. */ }
  if (!file) return t.skip('Local registry snapshot is not installed.');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(fileURLToPath(new URL(file, directory)), { readOnly: true });
  try {
    const spotify = db.prepare("SELECT SUM(quantity) tonnes FROM retirements WHERE project_id='CAR1480' AND vintage=2021 AND retired_on LIKE '2022%' AND shown_as='Spotify'").get();
    assert.equal(spotify.tonnes, 95000);
    const kinaxis = db.prepare('SELECT quantity, note, retired_on FROM retirements WHERE id=316960').get();
    assert.equal(kinaxis.quantity, 5000);
    assert.match(kinaxis.note, /Kinaxis/);
    assert.match(kinaxis.retired_on, /^2025/);
  } finally { db.close(); }
});
