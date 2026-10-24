import { $, h, api, busy, t, n, day, registryName } from './common.js';

const out = $('#result');
const msg = $('#msg');
const status = $('#lookup-status');
const form = $('#lookup');
let looking = false;

function claimLink(name, aliases) {
  const q = new URLSearchParams({ claimant: name });
  aliases.forEach((alias) => q.append('alias', alias));
  return `/?${q}`;
}

function show(profile, aliases) {
  if (!profile || typeof profile.name !== 'string' || !profile.name.trim()
      || !Number.isFinite(profile.retirements) || !Number.isFinite(profile.tonnes)
      || !Array.isArray(profile.by_year) || !Array.isArray(profile.top_projects)) {
    throw new Error('The lookup returned an incomplete response. Please try again.');
  }
  const p = profile;
  const heading = h('h2', { id: 'results-h', tabindex: '-1' }, `Records naming ${p.name}`);
  const count = p.limited ? `At least ${n(p.retirements)}` : n(p.retirements);
  const total = p.limited ? `At least ${t(p.tonnes)}` : t(p.tonnes);
  const fields = { beneficiary: 'Beneficiary', account: 'Retiring account', note: 'Retirement note' };
  out.replaceChildren(...[
    h('section', { class: 'section', 'aria-labelledby': 'results-h' },
      h('div', { class: 'section-head' }, heading,
        h('a', { href: location.pathname + location.search }, 'Link to this lookup')),
      p.dataset?.generated_at ? h('p', { class: 'hint', style: 'margin-bottom:16px' }, `${p.dataset.source || 'Registry'} snapshot: ${day(p.dataset.generated_at)}. This is historical data, not a live registry search.`) : null,
      p.retirements ? h('div', { class: 'figures card card-pad' },
        h('div', {}, h('div', { class: 'k' }, 'Matching retirement records'), h('div', { class: 'v' }, count)),
        h('div', {}, h('div', { class: 'k' }, 'Tonnes in those records'), h('div', { class: 'v' }, total))) : null,
      p.limited ? h('p', { class: 'note warn', style: 'margin-top:16px' }, 'Search limit reached. These are partial totals; the year and project breakdowns cover only the records returned. More matching records may exist.') : null,
      p.retirements === 0 ? h('div', { class: 'card card-pad' },
        h('h3', {}, 'No matching records found'),
        h('p', { style: 'margin-top:10px' }, `No retirement in this snapshot names ${p.name} using the names searched. This does not prove the company has never retired credits.`),
        h('p', { class: 'hint', style: 'margin-top:10px' }, 'Check the spelling, add a trading or subsidiary name, or review the original registry records. Later retirements are outside this snapshot.')) :
        h('p', { class: 'note', style: 'margin-top:16px' }, 'A name match is not proof that these credits offset this company’s emissions. Records can name a company as an intermediary retiring credits for someone else. Check a specific claim to inspect the supporting records.'),
      h('p', { class: 'small hint', style: 'margin-top:14px' }, `Names searched: ${(p.variants || [p.name]).map((v) => `“${v}”`).join(', ')}. Legal suffixes and punctuation are normalized.`),
      p.retirements && p.matched_on ? h('p', { class: 'small hint', style: 'margin-top:6px' },
        `Matched field: ${Object.entries(p.matched_on).filter(([, value]) => value > 0).map(([key, value]) => `${fields[key] || key}: ${n(value)}`).join('; ')}. Each retirement is counted once.`) : null,
      h('div', { class: 'actions', style: 'margin-top:18px' },
        h('a', { class: 'btn btn-primary', href: claimLink(p.name, aliases) }, 'Check a claim for this company'),
        h('a', { href: '/docs.html' }, 'How matching works'))),
    p.retirements && p.by_year.length ? h('section', { class: 'section card card-pad', 'aria-labelledby': 'years-h' },
      h('h2', { id: 'years-h' }, 'Retirements by year'),
      h('p', { class: 'hint', style: 'margin:8px 0 14px' }, 'Grouped by the date credits were retired, not their vintage.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('caption', { class: 'sr-only' }, `Tonnes in matching retirement records for ${p.name}, by retirement year`),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Retirement year'), h('th', { scope: 'col', class: 'r' }, 'Tonnes'))),
        h('tbody', {}, p.by_year.map((y) => h('tr', {}, h('th', { scope: 'row' }, y.year === 'unknown' ? 'Date not recorded' : y.year), h('td', { class: 'r' }, t(y.tonnes)))))))) : null,
    p.top_projects.length ? h('section', { class: 'section card card-pad', 'aria-labelledby': 'projects-h' },
      h('h2', { id: 'projects-h' }, 'Projects in matching records'),
      h('p', { class: 'hint', style: 'margin:8px 0 14px' }, 'Up to 15 projects, ordered by tonnes retired. These totals do not rate project quality.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('caption', { class: 'sr-only' }, `Largest projects in retirement records naming ${p.name}`),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Project'), h('th', { scope: 'col' }, 'Registry'), h('th', { scope: 'col' }, 'Country'), h('th', { scope: 'col', class: 'r' }, 'Tonnes'))),
        h('tbody', {}, p.top_projects.map((x) => h('tr', {}, h('th', { scope: 'row' },
          x.name ? `${x.name} ` : '', h('span', { class: 'mono' }, `(${x.id})`)),
        h('td', {}, registryName(x.registry) || 'Not recorded'), h('td', {}, x.country || 'Not recorded'), h('td', { class: 'r' }, t(x.tonnes)))))))) : null].filter(Boolean));
  status.textContent = p.retirements ? `${count} matching retirement records found for ${p.name}.` : `No matching retirement records found for ${p.name}.`;
  heading.focus({ preventScroll: true });
}

function invalid(field, text) {
  field.setAttribute('aria-invalid', 'true');
  msg.textContent = text;
  msg.hidden = false;
  field.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (looking) return;
  msg.hidden = true;
  $('#name').removeAttribute('aria-invalid');
  $('#alias').removeAttribute('aria-invalid');
  const name = $('#name').value.trim();
  const aliases = $('#alias').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (name.length < 3 || name.length > 120) { invalid($('#name'), 'Enter a company name between 3 and 120 characters.'); return; }
  if (aliases.length > 4) { invalid($('#alias'), 'Use up to four other names, one per line.'); return; }
  if (aliases.some((alias) => alias.length < 3 || alias.length > 120)) { invalid($('#alias'), 'Each other name must contain between 3 and 120 characters.'); return; }
  const q = new URLSearchParams({ name });
  aliases.forEach((alias) => q.append('alias', alias));
  const btn = $('#go');
  looking = true;
  busy(btn, true, 'Searching records…');
  $('#name').disabled = true;
  $('#alias').disabled = true;
  out.replaceChildren();
  out.setAttribute('aria-busy', 'true');
  status.textContent = `Searching retirement records for ${name}…`;
  try {
    const profile = await api(`/api/company?${q}`);
    history.replaceState(null, '', `${location.pathname}?${q}`);
    show(profile, aliases);
  } catch (err) {
    status.textContent = '';
    msg.textContent = `${err.message} Your search is still here; use “Search records” to try again.`;
    msg.hidden = false;
  } finally {
    out.setAttribute('aria-busy', 'false');
    busy(btn, false);
    $('#name').disabled = false;
    $('#alias').disabled = false;
    looking = false;
  }
});

const preset = new URLSearchParams(location.search);
if (preset.get('name')) {
  $('#name').value = preset.get('name');
  $('#alias').value = preset.getAll('alias').join('\n');
  form.requestSubmit();
}
