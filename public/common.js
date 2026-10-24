// Shared helpers for every page: formatting, API calls, plain-language verdicts and flags.

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
export const t = (value) => Number.isFinite(value) ? `${nf.format(value)} t` : 'Not recorded';
export const n = (value) => Number.isFinite(value) ? nf.format(value) : 'Not recorded';
export const day = (iso) => {
  if (!iso) return 'Date not recorded';
  const date = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export async function api(path, opts = {}) {
  const { timeout = path.endsWith('/anchor') ? 90_000 : path === '/api/extract' ? 60_000 : 25_000, signal, ...options } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const res = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    });
    let data = null;
    try { data = await res.json(); } catch (error) {
      if (error.name === 'AbortError') throw error;
      // The service may return a non-JSON error page.
    }
    if (!res.ok || !data || typeof data !== 'object' || Array.isArray(data)) {
      const fallback = res.status === 429 ? 'Too many requests. Please wait before trying again.'
        : res.status >= 500 ? 'The service is temporarily unavailable. Please try again.'
        : res.ok ? 'The service returned an unreadable response. Please try again.' : `Request failed (${res.status}). Please try again.`;
      const err = new Error(data?.error || fallback);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(signal?.aborted ? 'Request cancelled.' : 'This is taking too long. Please try again.');
    if (err instanceof TypeError) throw new Error('Could not connect. Check your internet connection and try again.');
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export const VERDICTS = {
  backed: { label: 'Quantity matched', tone: 'ok', say: (c) => `Retirement records naming this organisation cover the ${t(c.claimed)} entered. Review who is named below; a name match alone does not establish ownership or climate benefit.` },
  found: { label: 'Records found', tone: 'info', say: (c) => `${t(c.backed)} in retirement records naming this organisation. No quantity was entered, so there is no claim total to verify.` },
  partly_backed: { label: 'Partly backed', tone: 'warn', say: (c) => `Only ${t(c.backed)} of the ${t(c.claimed)} claimed is covered. ${t(c.gap)} has no matching retirement.` },
  used_by_earlier_claim: { label: 'Already counted', tone: 'bad', say: () => 'The matching retirements were already used to back an earlier claim in this report. One tonne can only back one claim.' },
  not_attributed: { label: 'Not attributed', tone: 'bad', say: (c) => `${t(c.scope.retired_total)} was retired in this scope, but none of it names this claimant.` },
  no_retirements: { label: 'No retirements', tone: 'bad', say: () => 'The snapshot has no retirements in this scope at all.' },
  project_not_found: { label: 'Project not in data', tone: 'bad', say: (c) => `${c.project_lookup?.wanted || 'This project'} is not in the registry snapshot. Check the ID, or the registry may not be covered.` },
  project_ambiguous: { label: 'Choose a project', tone: 'warn', say: () => 'Several projects match this name. Enter the registry project ID to check the intended project.' },
};

export const FLAGS = {
  project_matched_by_name: ['info', 'Project was matched by name, not ID. Check it is the right one.'],
  retired_exceeds_issued: ['warn', 'This snapshot lists more retired than issued credits for this vintage. Missing or inconsistent registry records can cause this; it does not establish double counting.'],
  no_issuance_recorded: ['warn', 'Credits were retired for this vintage, but no issuance is recorded in the snapshot.'],
  after_snapshot: ['warn', 'The claim year is after the snapshot (1 June 2026), so it cannot be checked with this data yet.'],
  partial_snapshot_year: ['info', 'The snapshot only covers 2026 up to 1 June.'],
  named_only_in_note: ['info', 'The claimant is named only in the free-text retirement note, not in the beneficiary field.'],
  retired_by_intermediary: ['info', 'An intermediary retired these credits on the claimant’s behalf.'],
  claimant_retired_for_someone_else: ['bad', 'The claimant is the account that retired these credits on behalf of a third party. The tonnes may belong to its client, not to the claimant.'],
  match_limit_reached: ['warn', 'The search reached its limit of 5,000 records per company name. Totals may be incomplete; narrow the search by project or year.'],
  rows_shared_with_earlier_claim: ['warn', 'Some matching tonnes were already counted for an earlier claim in this report.'],
  company_wide: ['info', 'Company-wide total: checked across every project in the snapshot.'],
};

export const verdictBadge = (v) => {
  const m = VERDICTS[v] || { label: v, tone: 'info' };
  return h('span', { class: `verdict v-${m.tone}` }, m.label);
};

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().filter((k) => value[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function busy(btn, on, text) {
  btn.setAttribute('aria-busy', String(on));
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spin', 'aria-hidden': 'true' }), text || btn.dataset.label);
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

export async function loadDataset() {
  try { return await api('/api/dataset'); } catch { return null; }
}

const REGISTRIES = { 'climate-action-reserve': 'Climate Action Reserve', 'american-carbon-registry': 'American Carbon Registry', 'art-trees': 'ART TREES', verra: 'Verra', 'gold-standard': 'Gold Standard', cercarbono: 'Cercarbono', isometric: 'Isometric', 'global-carbon-council': 'Global Carbon Council' };
export const registryName = (r) => REGISTRIES[r] || r || '';
