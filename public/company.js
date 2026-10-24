import { $, h, api, busy, t, n, registryName } from './common.js';

const out = $('#result');
const msg = $('#msg');

function show(p) {
  const max = Math.max(...p.by_year.map((y) => y.tonnes), 1);
  out.replaceChildren(
    h('div', { class: 'summary' },
      h('div', {}, h('div', { class: 'k' }, 'Company'), h('div', { class: 'v', style: 'font-size:1.05rem' }, p.name)),
      h('div', {}, h('div', { class: 'k' }, 'Retirements'), h('div', { class: 'v' }, n(p.retirements))),
      h('div', {}, h('div', { class: 'k' }, 'Tonnes retired'), h('div', { class: 'v' }, t(p.tonnes)))),
    p.limited ? h('div', { class: 'note warn' }, 'Very many retirements matched, so only the first 5,000 are counted. Real totals are higher.') : null,
    p.retirements === 0 ? h('div', { class: 'note warn' }, `No retirements in the snapshot name "${p.name}". Try another spelling, or a parent or subsidiary name.`) : null,
    p.retirements ? h('section', { class: 'section card card-pad' }, h('h2', {}, 'By year'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Year'), h('th', { class: 'r' }, 'Tonnes'), h('th', {}, h('span', { class: 'sr-only' }, 'Share')))),
        h('tbody', {}, p.by_year.map((y) => h('tr', {}, h('td', {}, y.year), h('td', { class: 'r' }, t(y.tonnes)),
          h('td', { style: 'width:40%' }, h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${(y.tonnes / max) * 100}%` }))))))))) : null,
    p.top_projects.length ? h('section', { class: 'section card card-pad' }, h('h2', {}, 'Largest projects'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Project'), h('th', {}, 'Registry'), h('th', {}, 'Country'), h('th', { class: 'r' }, 'Tonnes'))),
        h('tbody', {}, p.top_projects.map((x) => h('tr', {}, h('td', {}, x.name ? `${x.name} ` : '', h('span', { class: 'mono' }, `(${x.id})`)), h('td', {}, registryName(x.registry)), h('td', {}, x.country || ''), h('td', { class: 'r' }, t(x.tonnes))))))),
      h('p', { class: 'small hint', style: 'margin-top:12px' }, `Matched on the names ${p.variants.map((v) => `"${v}"`).join(', ')}. Retirements may name the company in the beneficiary, account or note field.`)) : null);
}

$('#lookup').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.hidden = true;
  const name = $('#name').value.trim();
  if (name.length < 3) { msg.textContent = 'Enter a company name (3+ letters).'; msg.hidden = false; $('#name').focus(); return; }
  const q = new URLSearchParams({ name });
  $('#alias').value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4).forEach((a) => q.append('alias', a));
  const btn = $('#go');
  busy(btn, true, 'Looking up…');
  try { show(await api(`/api/company?${q}`)); } catch (err) { msg.textContent = err.message; msg.hidden = false; }
  busy(btn, false);
});

const preset = new URLSearchParams(location.search).get('name');
if (preset) { $('#name').value = preset; $('#lookup').requestSubmit(); }
