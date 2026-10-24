import { $, h, api, busy, n, day, loadDataset } from './common.js';

const MAX_CLAIMS = 12;
const DRAFT_KEY = 'truetonne.claim-draft.v1';

// Snapshot records, not quotes or invented claims. Spotify's two CAR1480 rows
// (320004 + 320020) total 95,000 t; Kinaxis is named in CAR1335 row 316960.
const SAMPLES = [
  { title: 'Spotify · CAR1480', sub: '95,000 tonnes, vintage 2021, retired in 2022. Two records name Spotify.',
    claimant: 'Spotify', claims: [{ project: 'CAR1480', vintage: 2021, year: 2022, tonnes: 95000 }] },
  { title: 'Kinaxis · CAR1335', sub: '5,000 tonnes, vintage 2025, retired in 2025. The note names Kinaxis; ClimeCo is the retiring account.',
    claimant: 'Kinaxis', claims: [{ project: 'CAR1335', vintage: 2025, year: 2025, tonnes: 5000 }] },
  { title: 'ClimeCo · CAR1335', sub: 'The same 5,000 tonnes, entered for the broker that retired them. Record Kinaxis on-chain first, then this one.',
    claimant: 'ClimeCo', claims: [{ project: 'CAR1335', vintage: 2025, year: 2025, tonnes: 5000 }] },
  { title: 'Spotify · 150,000 tonnes', sub: 'The same project and year as the first example, with a larger quantity than the records show.',
    claimant: 'Spotify', claims: [{ project: 'CAR1480', vintage: 2021, year: 2022, tonnes: 150000 }] },
];

const rows = $('#claim-rows');
const tabs = [$('#tab-paste'), $('#tab-form')];
let selectedTab = 0;
let pending = '';
let datasetReady = false;
let draftTimer;

function selectTab(i, focus = false) {
  selectedTab = i;
  tabs.forEach((tab, j) => {
    const on = i === j;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $('#' + tab.getAttribute('aria-controls')).hidden = !on;
  });
  if (focus) tabs[i].focus();
  saveDraftSoon();
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(i));
  tab.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      selectTab(e.key === 'Home' ? 0 : e.key === 'End' ? 1 : (i + 1) % 2, true);
    }
  });
});

function updateControls() {
  const locked = Boolean(pending);
  document.querySelectorAll('#paste-form input, #paste-form textarea, #check-form input, #check-form textarea, #check-form button, .sample, .tab, #enter-manually').forEach((el) => { el.disabled = locked; });
  $('#extract-btn').disabled = locked;
  $('#check-btn').disabled = locked || !datasetReady;
  $('#add-row').disabled = locked || rows.children.length >= MAX_CLAIMS;
  $('#row-help').textContent = `${rows.children.length} of ${MAX_CLAIMS} claim rows${rows.children.length >= MAX_CLAIMS ? '. Remove a row to add another.' : '.'}`;
  $('#check-form').setAttribute('aria-busy', String(pending === 'check'));
  $('#paste-form').setAttribute('aria-busy', String(pending === 'extract'));
}

function relabelRows() {
  [...rows.children].forEach((tr, i) => {
    for (const input of tr.querySelectorAll('input')) {
      const label = { project: 'project ID or name', vintage: 'credit vintage year', year: 'retirement year', tonnes: 'tonnes of CO2 equivalent' }[input.name];
      input.setAttribute('aria-label', `Claim ${i + 1}: ${label}`);
    }
    const remove = tr.querySelector('button');
    remove.setAttribute('aria-label', rows.children.length === 1 ? 'Clear this claim row' : `Remove claim ${i + 1}`);
    remove.title = rows.children.length === 1 ? 'Clear this claim row' : `Remove claim ${i + 1}`;
  });
  updateControls();
}

function addRow(c = {}) {
  if (rows.children.length >= MAX_CLAIMS) return null;
  const input = (name, attrs) => h('input', { name, autocomplete: 'off', spellcheck: 'false', ...attrs });
  const tr = h('tr', {},
    h('td', { class: 'c-proj', 'data-label': 'Project ID or name' }, input('project', { maxlength: 160, value: c.project || c.project_id || c.project_name || '' })),
    h('td', { 'data-label': 'Vintage' }, input('vintage', { inputmode: 'numeric', maxlength: 4, value: c.vintage ?? '' })),
    h('td', { 'data-label': 'Retired in' }, input('year', { inputmode: 'numeric', maxlength: 4, value: c.year ?? '' })),
    h('td', { 'data-label': 'Tonnes CO₂e' }, input('tonnes', { inputmode: 'decimal', maxlength: 24, value: c.tonnes ?? '' })),
    h('td', {}, h('button', { class: 'btn btn-quiet btn-icon', type: 'button', onclick: () => {
      const next = tr.nextElementSibling || tr.previousElementSibling;
      if (rows.children.length > 1) tr.remove();
      else tr.querySelectorAll('input').forEach((el) => { el.value = ''; el.removeAttribute('aria-invalid'); });
      relabelRows();
      (next || rows.firstElementChild)?.querySelector('input')?.focus();
      hideCheckError();
      saveDraftSoon();
    } }, '×')),
  );
  rows.append(tr);
  relabelRows();
  return tr;
}

function fillForm({ claimant = '', aliases = [], claims = [], source = '' }, focus = true) {
  $('#claimant').value = claimant;
  $('#aliases').value = aliases.join('\n');
  rows.replaceChildren();
  (claims.length ? claims : [{}]).slice(0, MAX_CLAIMS).forEach(addRow);
  $('#source-text').value = source;
  $('#source-preview').hidden = !source;
  $('#source-preview').open = false;
  $('#source-preview-text').textContent = source;
  $('#paste').value = source;
  $('#extract-msg').hidden = true;
  $('#paste').removeAttribute('aria-invalid');
  updateCharacterCount();
  $('#review-note').hidden = true;
  hideCheckError();
  selectTab(1);
  if (focus) $('#claimant').focus();
}

const looksLikeId = (s) => /^\s*(vcs|verra|vcu|vm|gs|gld|gold\s?standard|car|climate action reserve|acr|american carbon registry|art\s?trees|art|trees|ccb|iso)[\s#:-]*(?:project\s*)?(?:id\s*)?[\s#:-]*\d/i.test(s)
  || /^[a-z]{2,8}\d[a-z0-9]{0,8}$/i.test(s);

function readForm() {
  return {
    claimant: $('#claimant').value.trim(),
    aliases: $('#aliases').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    claims: [...rows.children].map((tr) => {
      const value = (name) => tr.querySelector(`[name=${name}]`).value.trim();
      const project = value('project');
      return {
        project_id: project && looksLikeId(project) ? project : null,
        project_name: project && !looksLikeId(project) ? project : null,
        vintage: value('vintage') || null,
        year: value('year') || null,
        tonnes: value('tonnes') || null,
      };
    }),
    source_text: $('#source-text').value || undefined,
  };
}

function showError(msg, errors) {
  msg.className = 'note bad';
  msg.replaceChildren(errors.length === 1 ? errors[0] : h('div', {}, 'Please fix the following:', h('ul', {}, errors.map((text) => h('li', {}, text)))));
  msg.hidden = false;
}

function hideCheckError() {
  $('#check-msg').hidden = true;
  $('#check-form').querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
}

function validateForm(body) {
  const errors = [];
  const invalidate = (input, text) => { input.setAttribute('aria-invalid', 'true'); errors.push(text); };
  const searchableName = (name) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '');
  if (searchableName(body.claimant).length < 3) invalidate($('#claimant'), 'Enter the company name as recorded in the registry, using at least 3 Latin letters or numbers.');
  if (body.aliases.length > 4 || body.aliases.some((alias) => alias.length > 120)) invalidate($('#aliases'), 'Use up to four other company names, no more than 120 characters each.');
  else if (body.aliases.some((alias) => searchableName(alias).length < 3)) invalidate($('#aliases'), 'Each other company name needs at least 3 Latin letters or numbers.');
  body.claims.forEach((c, i) => {
    const tr = rows.children[i];
    const field = (name) => tr.querySelector(`[name=${name}]`);
    if (!c.project_id && !c.project_name && c.tonnes === null) invalidate(field('project'), `Claim ${i + 1}: enter a project or the number of tonnes claimed.`);
    for (const name of ['vintage', 'year']) {
      if (c[name] !== null && (!/^\d{4}$/.test(c[name]) || Number(c[name]) < 1990 || Number(c[name]) > 2100)) {
        invalidate(field(name), `Claim ${i + 1}: ${name === 'vintage' ? 'vintage' : 'retirement year'} must be a year between 1990 and 2100, or left blank.`);
      }
    }
    if (c.vintage && c.year && Number(c.vintage) > Number(c.year)) invalidate(field('year'), `Claim ${i + 1}: the retirement year cannot be earlier than the credit vintage.`);
    if (c.tonnes !== null) {
      const amount = Number(c.tonnes.replace(/,/g, ''));
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,3})?$/.test(c.tonnes) || !Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER / 1000) {
        invalidate(field('tonnes'), `Claim ${i + 1}: tonnes must be greater than zero, with up to three decimal places. Use a number such as 95,000 or 95000.5.`);
      }
    }
  });
  return errors;
}

$('#add-row').addEventListener('click', () => {
  addRow()?.querySelector('input').focus();
  saveDraftSoon();
});

$('#clear-form').addEventListener('click', () => {
  fillForm({});
  $('#extract-msg').hidden = true;
  $('#form-notice').hidden = true;
  saveDraft();
});

function enterManually() {
  const source = $('#paste').value.trim();
  $('#source-text').value = source;
  $('#source-preview').hidden = !source;
  $('#source-preview-text').textContent = source;
  const note = $('#review-note');
  note.className = 'note';
  note.textContent = source ? 'Your pasted text will be saved as the report source. Enter or update the details below to match it.' : 'Enter the details from the claim you want to check.';
  note.hidden = false;
  selectTab(1);
  $('#claimant').focus();
  saveDraft();
}

$('#enter-manually').addEventListener('click', enterManually);

$('#check-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (pending) return;
  hideCheckError();
  const msg = $('#check-msg');
  const body = readForm();
  const errors = validateForm(body);
  if (!datasetReady) errors.push('Registry data is unavailable. Use “Retry loading registry data” above, then try again.');
  if (errors.length) {
    showError(msg, errors);
    ($('#check-form [aria-invalid="true"]') || msg).focus();
    return;
  }
  saveDraft();
  pending = 'check';
  busy($('#check-btn'), true, 'Creating your report…');
  updateControls();
  try {
    const res = await api('/api/check', { method: 'POST', body });
    if (!/^[A-Za-z0-9_-]{12}$/.test(res?.id || '')) throw new Error('The server could not create a report link. Your inputs are still here; please try again.');
    location.assign(`/r/${res.id}`);
  } catch (err) {
    const errors = Array.isArray(err.data?.errors) && err.data.errors.length ? err.data.errors : [err.message];
    showError(msg, errors);
    pending = '';
    busy($('#check-btn'), false);
    updateControls();
    msg.focus();
  }
});

$('#paste-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (pending) return;
  const text = $('#paste').value.trim();
  const msg = $('#extract-msg');
  msg.hidden = true;
  if (text.length < 20) {
    showError(msg, ['Paste at least one sentence that describes the carbon credits used or retired.']);
    $('#paste').setAttribute('aria-invalid', 'true');
    $('#paste').focus();
    return;
  }
  if (text.length > 6000) {
    showError(msg, ['Shorten the text to 6,000 characters or fewer.']);
    $('#paste').focus();
    return;
  }
  pending = 'extract';
  busy($('#extract-btn'), true, 'Reading the claim…');
  updateControls();
  try {
    const res = await api('/api/extract', { method: 'POST', body: { text } });
    if (!Array.isArray(res?.claims)) throw new Error('The AI returned an unreadable result. Try again or enter the details yourself.');
    if (!res.claims.length) {
      msg.className = 'note warn';
      msg.replaceChildren('No usable carbon-credit details were found. Try a more specific passage, or ', h('button', { type: 'button', class: 'btn btn-quiet', onclick: enterManually }, 'enter the details yourself'), '.');
      msg.hidden = false;
      msg.focus();
      return;
    }
    fillForm({ claimant: res.claimant || '', claims: res.claims, source: text }, false);
    const dropped = Array.isArray(res.dropped) ? res.dropped : [];
    const info = $('#review-note');
    info.className = 'note';
    info.replaceChildren(
      `Found ${res.claims.length} claim${res.claims.length > 1 ? 's' : ''}. Review the company, projects, amounts and years against your source before creating the report.`,
      dropped.length ? h('div', {}, 'The following details were left out because they could not be found in your text:', h('ul', {}, dropped.map((d) => h('li', {}, d)))) : '',
    );
    info.hidden = false;
    $('#form-h').scrollIntoView({ block: 'start' });
  } catch (err) {
    showError(msg, [err.message]);
    msg.append(' ', h('button', { type: 'button', class: 'btn btn-quiet', onclick: enterManually }, 'Enter the details yourself'));
    msg.focus();
  } finally {
    pending = '';
    busy($('#extract-btn'), false);
    updateControls();
    if (selectedTab === 1) $('#claimant').focus();
    saveDraft();
  }
});

function updateCharacterCount() { $('#paste-count').textContent = `${n($('#paste').value.length)} / 6,000 characters`; }

$('#paste').addEventListener('input', () => {
  $('#extract-msg').hidden = true;
  $('#paste').removeAttribute('aria-invalid');
  updateCharacterCount();
  saveDraftSoon();
});
$('#check-form').addEventListener('input', () => { hideCheckError(); saveDraftSoon(); });

$('#samples').append(...SAMPLES.map((sample) => h('button', {
  class: 'sample', type: 'button',
  onclick: () => {
    fillForm(sample);
    $('#form-notice').hidden = true;
    const note = $('#review-note');
    note.className = 'note';
    note.textContent = 'Loaded a registry example. Review or change the details, then create a report. These inputs are not a quoted company claim.';
    note.hidden = false;
    $('#form-h').scrollIntoView({ block: 'start' });
    saveDraft();
  },
}, h('b', {}, sample.title), h('span', {}, sample.sub), h('span', {}, 'Load these details →'))));

function saveDraftSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 200);
}

function saveDraft() {
  clearTimeout(draftTimer);
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...readForm(), paste: $('#paste').value, tab: selectedTab }));
  } catch { /* Private browsing or full storage must not prevent a check. */ }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft || typeof draft !== 'object' || !Array.isArray(draft.claims)) return;
    fillForm({ claimant: String(draft.claimant || '').slice(0, 120), aliases: Array.isArray(draft.aliases) ? draft.aliases.slice(0, 4).map(String) : [], claims: draft.claims, source: String(draft.source_text || '').slice(0, 6000) }, false);
    $('#paste').value = String(draft.paste || '').slice(0, 6000);
    updateCharacterCount();
    selectTab(draft.tab === 1 ? 1 : 0);
  } catch { /* Ignore an invalid or unavailable session draft. */ }
}

async function loadRegistry() {
  const retry = $('#dataset-retry');
  const stamp = $('#stamp');
  datasetReady = false;
  retry.hidden = true;
  stamp.className = 'stamp';
  stamp.textContent = 'Checking registry data availability…';
  updateControls();
  const data = await loadDataset();
  if (data?.dataset?.generated_at && Number(data.dataset.retirements) > 0) {
    datasetReady = true;
    stamp.replaceChildren(h('span', {}, 'CarbonPlan OffsetsDB snapshot: ', h('b', {}, day(data.dataset.generated_at.slice(0, 10)))), h('span', {}, h('b', {}, n(data.dataset.retirements)), ' retirement records'), h('a', { href: '/docs.html#coverage' }, 'Coverage and limits'));
  } else {
    stamp.className = 'note warn';
    stamp.textContent = 'Registry data is unavailable right now. Your inputs are kept in this tab; retry to run a check.';
    retry.hidden = false;
  }
  updateControls();
}

async function loadLinkedInputs() {
  const params = new URLSearchParams(location.search);
  const edit = params.get('edit');
  const claimant = params.get('claimant');
  const notice = $('#form-notice');
  if (edit !== null) {
    selectTab(1);
    notice.hidden = false;
    if (!/^[A-Za-z0-9_-]{12}$/.test(edit)) {
      notice.className = 'note bad';
      notice.textContent = 'That report link is invalid. You can enter the claim details below.';
      return;
    }
    notice.textContent = 'Loading the report inputs…';
    pending = 'load';
    updateControls();
    try {
      const { report } = await api(`/api/report/${encodeURIComponent(edit)}`);
      if (!report?.claimant || !Array.isArray(report.claims)) throw new Error('The saved report has no readable claim inputs.');
      fillForm({ claimant: report.claimant, aliases: report.aliases || [], claims: report.claims.map((c) => c.input), source: report.source_text || '' }, false);
      notice.className = 'note';
      notice.replaceChildren('Loaded the inputs from ', h('a', { href: `/r/${edit}` }, 'your report'), '. Changes create a new report.');
      saveDraft();
    } catch (err) {
      notice.className = 'note bad';
      notice.textContent = `${err.message} Your current inputs are still available below.`;
    } finally {
      pending = '';
      updateControls();
    }
  } else if (claimant) {
    fillForm({ claimant: claimant.slice(0, 120), aliases: params.getAll('alias').slice(0, 4).map((alias) => alias.slice(0, 120)) }, false);
    notice.textContent = `Enter the carbon credits claimed by ${claimant.slice(0, 120)} below.`;
    notice.hidden = false;
    saveDraft();
  }
}

$('#dataset-retry').addEventListener('click', loadRegistry);
window.addEventListener('pagehide', saveDraft);
window.addEventListener('pageshow', (event) => {
  // Returning from a report may restore the page from the back/forward cache.
  if (event.persisted) {
    pending = '';
    busy($('#check-btn'), false);
    busy($('#extract-btn'), false);
    updateControls();
  }
});

addRow();
restoreDraft();
updateControls();
loadRegistry();
loadLinkedInputs();
