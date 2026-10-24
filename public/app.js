import { $, h, api, busy, n, day, loadDataset } from './common.js';

// Real entries from the snapshot, so every sample gives a result a judge can re-check on the registry.
const SAMPLES = [
  { title: 'Spotify, 95,000 t', sub: 'Phlogiston N₂O project (CAR1480), vintage 2021, retired 2022. A clean match.',
    claimant: 'Spotify', claims: [{ project: 'CAR1480', vintage: 2021, year: 2022, tonnes: 95000 }] },
  { title: 'Spotify claims 150,000 t', sub: 'Same project, more tonnes than were retired in its name.',
    claimant: 'Spotify', claims: [{ project: 'CAR1480', vintage: 2021, year: 2022, tonnes: 150000 }] },
  { title: 'Spotify on Kasigau REDD', sub: 'VCS562, vintage 2016: retired by others, and over-retired in the data.',
    claimant: 'Spotify', claims: [{ project: 'VCS562', vintage: 2016, tonnes: 10000 }] },
  { title: 'Kinaxis, 5,000 t', sub: 'CAR1335, vintage 2025. Retired by ClimeCo on Kinaxis’s behalf.',
    claimant: 'Kinaxis', claims: [{ project: 'CAR1335', vintage: 2025, tonnes: 5000 }] },
  { title: 'ClimeCo claims the same 5,000 t', sub: 'The broker that retired them. Record Kinaxis on-chain first, then this.',
    claimant: 'ClimeCo', claims: [{ project: 'CAR1335', vintage: 2025, tonnes: 5000 }] },
  { title: 'Paste a paragraph', sub: 'Example text written for this demo (not a quote) for the AI step.', paste: true },
];

const EXAMPLE_TEXT = `Example text written for this demo, not a quote from the company:

In 2022 Spotify retired 95,000 tonnes of carbon credits from the Phlogiston Phase I project (CAR 1480), vintage 2021, and 85,000 tonnes from VCS 1842, a 100 MW solar project in Rajasthan. It also retired 40,000 tonnes from VCS 1914 and 60,000 tonnes from VCS 1844, all vintage 2021.`;

const rows = $('#claim-rows');
const tabs = [$('#tab-paste'), $('#tab-form')];

function selectTab(i, focus = false) {
  tabs.forEach((tab, j) => {
    const on = i === j;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $('#' + tab.getAttribute('aria-controls')).hidden = !on;
  });
  if (focus) tabs[i].focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(i));
  tab.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); selectTab((i + 1) % 2, true); }
  });
});

function addRow(c = {}) {
  const idx = rows.children.length;
  const input = (name, attrs) => h('input', { name, 'aria-label': attrs.label, autocomplete: 'off', spellcheck: 'false', ...attrs, label: null });
  const tr = h('tr', {},
    h('td', { class: 'c-proj', 'data-label': 'Project ID or name' }, input('project', { label: `Claim ${idx + 1} project`, maxlength: 160, placeholder: 'VCS1477 or "Kariba REDD+"', value: c.project || '' })),
    h('td', { 'data-label': 'Vintage' }, input('vintage', { label: `Claim ${idx + 1} vintage`, inputmode: 'numeric', pattern: '\\d{4}', maxlength: 4, placeholder: '2021', value: c.vintage || '' })),
    h('td', { 'data-label': 'Retired in' }, input('year', { label: `Claim ${idx + 1} retirement year`, inputmode: 'numeric', pattern: '\\d{4}', maxlength: 4, placeholder: '2022', value: c.year || '' })),
    h('td', { 'data-label': 'Tonnes CO₂e' }, input('tonnes', { label: `Claim ${idx + 1} tonnes`, inputmode: 'decimal', maxlength: 16, placeholder: '95,000', value: c.tonnes ? n(c.tonnes) : '' })),
    h('td', {}, h('button', { class: 'btn btn-quiet btn-icon', type: 'button', 'aria-label': `Remove claim ${idx + 1}`, onclick: () => { tr.remove(); if (!rows.children.length) addRow(); } }, '×')),
  );
  rows.append(tr);
  return tr;
}

function fillForm({ claimant = '', aliases = [], claims = [], source = '' }) {
  $('#claimant').value = claimant;
  $('#aliases').value = aliases.join(', ');
  rows.replaceChildren();
  (claims.length ? claims : [{}]).forEach(addRow);
  $('#source-text').value = source;
  $('#check-msg').hidden = true;
  selectTab(1);
}

const looksLikeId = (s) => /^\s*(vcs|verra|gs|gld|gold standard|car|acr|art|ccb|iso)[\s#:-]*[a-z0-9]*\d/i.test(s);

function readForm() {
  const claims = [...rows.children].map((tr) => {
    const v = (name) => tr.querySelector(`[name=${name}]`).value.trim();
    const project = v('project');
    return {
      project_id: project && looksLikeId(project) ? project : null,
      project_name: project && !looksLikeId(project) ? project : null,
      vintage: v('vintage') || null,
      year: v('year') || null,
      tonnes: v('tonnes') || null,
    };
  }).filter((c) => c.project_id || c.project_name || c.tonnes || c.vintage || c.year);
  return {
    claimant: $('#claimant').value.trim(),
    aliases: $('#aliases').value.split(',').map((s) => s.trim()).filter(Boolean),
    claims,
    source_text: $('#source-text').value || undefined,
  };
}

$('#add-row').addEventListener('click', () => addRow().querySelector('input').focus());

$('#check-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#check-msg');
  msg.hidden = true;
  const body = readForm();
  const claimant = $('#claimant');
  claimant.removeAttribute('aria-invalid');
  if (body.claimant.length < 3) {
    claimant.setAttribute('aria-invalid', 'true');
    msg.textContent = 'Enter who makes the claim (3+ letters).';
    msg.hidden = false;
    claimant.focus();
    return;
  }
  if (!body.claims.length) {
    msg.textContent = 'Fill in at least one claim: a project, tonnes, or both.';
    msg.hidden = false;
    rows.querySelector('input')?.focus();
    return;
  }
  const btn = $('#check-btn');
  busy(btn, true, 'Checking…');
  try {
    const { id } = await api('/api/check', { method: 'POST', body });
    location.href = `/r/${id}`;
  } catch (err) {
    busy(btn, false);
    const all = err.data?.errors;
    msg.replaceChildren(all && all.length > 1 ? h('span', {}, 'Please fix these:', h('ul', {}, all.map((x) => h('li', {}, x)))) : err.message);
    msg.hidden = false;
  }
});

$('#paste-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#paste').value.trim();
  const msg = $('#extract-msg');
  msg.hidden = true;
  msg.className = 'note warn';
  if (text.length < 20) {
    msg.textContent = 'Paste at least a sentence that mentions the credits retired.';
    msg.hidden = false;
    return;
  }
  const btn = $('#extract-btn');
  busy(btn, true, 'Reading…');
  try {
    const res = await api('/api/extract', { method: 'POST', body: { text } });
    busy(btn, false);
    if (!res.claims.length) {
      msg.replaceChildren('No retired credits found in that text. ', h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); selectTab(1); } }, 'Enter the claims by hand instead.'));
      msg.hidden = false;
      return;
    }
    fillForm({
      claimant: res.claimant,
      claims: res.claims.map((c) => ({ project: c.project_id || c.project_name, vintage: c.vintage, year: c.year, tonnes: c.tonnes })),
      source: text,
    });
    const info = $('#check-msg');
    info.className = res.dropped.length ? 'note warn' : 'note ok';
    info.replaceChildren(
      `Found ${res.claims.length} claim${res.claims.length > 1 ? 's' : ''}. Check them, fill in anything missing, then run the check.`,
      res.dropped.length ? h('span', {}, ' Left out because it is not in your text:', h('ul', {}, res.dropped.map((d) => h('li', {}, d)))) : '',
    );
    info.hidden = false;
    if (!res.claimant) $('#claimant').focus();
  } catch (err) {
    busy(btn, false);
    msg.className = 'note bad';
    msg.replaceChildren(err.message + ' ', h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); selectTab(1); } }, 'Enter the claims by hand.'));
    msg.hidden = false;
  }
});

// A validation error goes away once the user edits the form; the AI summary note stays.
$('#check-form').addEventListener('input', () => { const m = $('#check-msg'); if (m.classList.contains('bad')) m.hidden = true; });

$('#samples').append(...SAMPLES.map((s) => h('button', {
  class: 'sample', type: 'button',
  onclick: () => {
    if (s.paste) {
      selectTab(0);
      $('#paste').value = EXAMPLE_TEXT;
      $('#paste').focus();
    } else {
      fillForm(s);
      $('#check-btn').focus();
    }
    $('#form-h').scrollIntoView({ block: 'start' });
  },
}, h('b', {}, s.title), h('span', {}, s.sub))));

addRow();

loadDataset().then((d) => {
  if (!d?.dataset) return;
  $('#stamp-date').textContent = day(d.dataset.generated_at.slice(0, 10));
  $('#stamp-n').textContent = n(d.dataset.retirements);
});
