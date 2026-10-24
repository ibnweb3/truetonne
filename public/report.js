import { $, h, api, busy, t, day, verdictBadge, registryName, VERDICTS, FLAGS, canonical, sha256Hex } from './common.js';

const id = location.pathname.split('/').pop();
const main = $('#main');

function claimCard(c) {
  const v = VERDICTS[c.verdict];
  const p = c.project;
  const title = p ? `${p.name} (${p.id})` : c.flags.includes('company_wide') ? 'Company-wide total' : c.project_lookup?.wanted || 'Project';
  const scopeBits = [c.input.vintage && `vintage ${c.input.vintage}`, c.input.year && `retired in ${c.input.year}`].filter(Boolean).join(', ');
  const pct = c.claimed ? Math.min(100, (c.backed / c.claimed) * 100) : 0;
  return h('article', { class: 'card claim' },
    h('div', { class: 'claim-head' },
      h('div', {}, h('h3', {}, `Claim ${c.n}: ${title}`),
        h('p', { class: 'meta' }, [p && [registryName(p.registry), p.country, p.type].filter(Boolean).join(' · '), scopeBits].filter(Boolean).join(' — '))),
      verdictBadge(c.verdict)),
    h('div', { class: 'claim-body' },
      h('p', {}, v ? v.say(c) : ''),
      h('div', { class: 'figures' },
        h('div', {}, h('div', { class: 'k' }, 'Claimed'), h('div', { class: 'v' }, t(c.claimed))),
        h('div', {}, h('div', { class: 'k' }, 'Backed'), h('div', { class: 'v' }, t(c.backed))),
        c.gap ? h('div', {}, h('div', { class: 'k' }, 'Gap'), h('div', { class: 'v' }, t(c.gap))) : null),
      c.claimed ? h('div', { class: 'bar', role: 'img', 'aria-label': `${Math.round(pct)}% backed` }, h('i', { style: `width:${pct}%` })) : null,
      c.flags.length ? h('ul', { class: 'flags' }, c.flags.filter((f) => FLAGS[f]).map((f) => h('li', { class: FLAGS[f][0] }, FLAGS[f][1]))) : null,
      c.rows.length ? h('details', { open: c.rows.length <= 5 },
        h('summary', {}, `Backing retirements (${c.rows_total})`),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Row'), h('th', {}, 'Retired'), h('th', { class: 'r' }, 'Used'), h('th', { class: 'r' }, 'Of'), h('th', {}, 'Named as'), h('th', {}, 'Matched on'))),
          h('tbody', {}, c.rows.map((r) => h('tr', {},
            h('td', { class: 'mono' }, `#${r.id}`), h('td', {}, day(r.retired_on)), h('td', { class: 'r' }, t(r.used)), h('td', { class: 'r' }, t(r.quantity)),
            h('td', {}, r.shown_as || r.account || 'not named', r.note ? h('div', { class: 'hint small' }, r.note) : null), h('td', {}, r.matched_on))))))) : null,
      c.scope.top.length ? h('details', {},
        h('summary', {}, `Everyone who retired in this scope (${t(c.scope.retired_total)})`),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Named as'), h('th', { class: 'r' }, 'Tonnes'), h('th', { class: 'r' }, 'Retirements'))),
          h('tbody', {}, c.scope.top.map((x) => h('tr', {}, h('td', {}, x.name || 'not named in registry data'), h('td', { class: 'r' }, t(x.tonnes)), h('td', { class: 'r' }, x.retirements))))))) : null,
      p?.url ? h('p', { class: 'small' }, h('a', { href: p.url, rel: 'noopener', target: '_blank' }, `Open ${p.id} on the registry`)) : null));
}

function chainPanel(data, refresh) {
  const { anchor, ledger, chain } = data;
  const box = h('section', { class: 'card card-pad section', 'aria-labelledby': 'chain-h' }, h('h2', { id: 'chain-h' }, 'On-chain record'));
  if (!chain) return box.append(h('p', { class: 'hint' }, 'On-chain recording is not configured on this server.')), box;
  const others = (ledger?.rows || []).filter((r) => r.held_by_others > 0);
  if (anchor) {
    box.append(h('p', { style: 'margin-top:8px' }, 'Recorded on ', h('a', { href: anchor.url || `${chain.explorer}/tx/${anchor.tx}`, target: '_blank', rel: 'noopener' }, 'Base Sepolia'), anchor.block ? ` in block ${anchor.block}.` : '.'));
    if (anchor.blocked?.length) box.append(h('div', { class: 'note bad', style: 'margin-top:12px' }, h('b', {}, 'Double claim blocked. '),
      `The contract refused ${anchor.blocked.length} retirement row${anchor.blocked.length > 1 ? 's' : ''}: those tonnes are already held by another claimant.`,
      h('ul', {}, anchor.blocked.map((b) => h('li', {}, `Row #${b.row}: asked for ${t(b.requested)}, ${t(b.held_by_others)} of ${t(b.cap)} already held by others`)))));
    if (anchor.claimed?.length) box.append(h('div', { class: 'note ok', style: 'margin-top:12px' }, `${anchor.claimed.length} row${anchor.claimed.length > 1 ? 's' : ''} now held by this claimant on-chain.`));
  } else {
    box.append(h('p', { class: 'hint', style: 'margin-top:8px' }, 'Recording gives this claimant the backing tonnes on the TonneLedger contract. Anyone who later claims the same tonnes is refused.'));
    if (others.length) box.append(h('div', { class: 'note bad', style: 'margin-top:12px' }, `Warning: ${others.length} backing row${others.length > 1 ? 's are' : ' is'} already held on-chain by another claimant.`));
    const btn = h('button', { class: 'btn btn-primary', type: 'button', style: 'margin-top:14px' }, 'Record on-chain');
    const msg = h('div', { class: 'note bad', role: 'alert', hidden: true, style: 'margin-top:12px' });
    btn.addEventListener('click', async () => {
      busy(btn, true, 'Recording…');
      try { await api(`/api/report/${id}/anchor`, { method: 'POST' }); refresh(); } catch (e) { busy(btn, false); msg.textContent = e.message; msg.hidden = false; }
    });
    box.append(btn, msg);
  }
  box.append(h('p', { class: 'small hint', style: 'margin-top:12px' }, 'Contract: ', h('a', { href: chain.ledger_url, target: '_blank', rel: 'noopener', class: 'mono' }, chain.ledger)));
  return box;
}

function proofPanel(data) {
  const out = h('span', { class: 'small', 'aria-live': 'polite' });
  const btn = h('button', { class: 'btn', type: 'button' }, 'Re-hash in my browser');
  btn.addEventListener('click', async () => {
    const mine = await sha256Hex(canonical(data.report));
    out.textContent = mine === data.hash ? ' ✓ Matches. This report has not been changed.' : ' ✗ Does not match.';
  });
  const dl = h('a', { class: 'btn', download: `truetonne-${id}.json`, href: URL.createObjectURL(new Blob([JSON.stringify(data.report, null, 2)], { type: 'application/json' })) }, 'Download JSON');
  return h('section', { class: 'card card-pad section' }, h('h2', {}, 'Proof'),
    h('dl', { class: 'kv', style: 'margin:12px 0' },
      h('dt', {}, 'Report hash'), h('dd', { class: 'hash' }, data.hash),
      h('dt', {}, 'Dataset'), h('dd', {}, `${data.report.dataset.source}, ${day(data.report.dataset.generated_at.slice(0, 10))}`),
      h('dt', {}, 'Dataset SHA-256'), h('dd', { class: 'hash' }, data.report.dataset.zip_sha256)),
    h('div', { class: 'actions' }, btn, dl, out));
}

async function render() {
  let data;
  try { data = await api(`/api/report/${id}`); } catch (e) {
    main.replaceChildren(h('section', { class: 'hero' }, h('h1', {}, 'Report not found'), h('p', { class: 'lede' }, e.message, ' ', h('a', { href: '/' }, 'Run a new check.'))));
    return;
  }
  const r = data.report;
  document.title = `${r.claimant}: ${r.summary.tonnes_backed.toLocaleString('en-US')} of ${r.summary.tonnes_claimed.toLocaleString('en-US')} t backed · TrueTonne`;
  main.replaceChildren(
    h('section', { class: 'hero' }, h('p', { class: 'hint' }, `Check report · ${day(r.created_at.slice(0, 10))}`), h('h1', {}, r.claimant),
      h('p', { class: 'lede' }, r.summary.tonnes_claimed ? `${t(r.summary.tonnes_backed)} of ${t(r.summary.tonnes_claimed)} claimed is backed by registry retirements naming this claimant.` : 'Retirements found in the registry snapshot.')),
    h('div', { class: 'summary' },
      h('div', {}, h('div', { class: 'k' }, 'Claims'), h('div', { class: 'v' }, r.summary.claims)),
      h('div', {}, h('div', { class: 'k' }, 'Tonnes claimed'), h('div', { class: 'v' }, t(r.summary.tonnes_claimed))),
      h('div', {}, h('div', { class: 'k' }, 'Tonnes backed'), h('div', { class: 'v' }, t(r.summary.tonnes_backed))),
      h('div', {}, h('div', { class: 'k' }, 'Snapshot'), h('div', { class: 'v', style: 'font-size:1.05rem' }, day(r.dataset.generated_at.slice(0, 10))))),
    ...r.claims.map(claimCard),
    chainPanel(data, render),
    proofPanel(data));
}
render();
