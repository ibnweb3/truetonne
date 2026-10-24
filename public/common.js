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
export const t = (n) => (n === null || n === undefined ? '—' : `${nf.format(n)} t`);
export const n = (x) => nf.format(x);
export const day = (iso) => (iso ? new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'date not recorded');

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.data = data;
    throw err;
  }
  return data;
}

export const VERDICTS = {
  backed: { label: 'Backed', tone: 'ok', say: (c) => `Registry retirements naming this claimant cover the ${t(c.claimed)} claimed.` },
  found: { label: 'Found', tone: 'ok', say: (c) => `${t(c.backed)} retired naming this claimant. No tonnage was claimed, so nothing to compare.` },
  partly_backed: { label: 'Partly backed', tone: 'warn', say: (c) => `Only ${t(c.backed)} of the ${t(c.claimed)} claimed is covered. ${t(c.gap)} has no matching retirement.` },
  used_by_earlier_claim: { label: 'Already counted', tone: 'bad', say: () => 'The matching retirements were already used to back an earlier claim in this report. One tonne can only back one claim.' },
  not_attributed: { label: 'Not attributed', tone: 'bad', say: (c) => `${t(c.scope.retired_total)} was retired in this scope, but none of it names this claimant.` },
  no_retirements: { label: 'No retirements', tone: 'bad', say: () => 'The snapshot has no retirements in this scope at all.' },
  project_not_found: { label: 'Project not in data', tone: 'bad', say: (c) => `${c.project_lookup?.wanted || 'This project'} is not in the registry snapshot. Check the ID, or the registry may not be covered.` },
};

export const FLAGS = {
  project_matched_by_name: ['info', 'Project was matched by name, not ID. Check it is the right one.'],
  retired_exceeds_issued: ['bad', 'Registry data shows more credits retired than issued for this vintage. This can be a data issue, but it is exactly what double counting looks like. Treat with care.'],
  no_issuance_recorded: ['warn', 'Credits were retired for this vintage, but no issuance is recorded in the snapshot.'],
  after_snapshot: ['warn', 'The claim year is after the snapshot (1 June 2026), so it cannot be checked with this data yet.'],
  partial_snapshot_year: ['info', 'The snapshot only covers 2026 up to 1 June.'],
  named_only_in_note: ['info', 'The claimant is named only in the free-text retirement note, not in the beneficiary field.'],
  retired_by_intermediary: ['info', 'An intermediary retired these credits on the claimant’s behalf.'],
  claimant_retired_for_someone_else: ['bad', 'The claimant is the account that retired these credits on behalf of a third party. The tonnes may belong to its client, not to the claimant.'],
  match_limit_reached: ['warn', 'Very many retirements matched; only the first 5,000 were used.'],
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
