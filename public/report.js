import { $, h, api, busy, t, n, day, verdictBadge, registryName, VERDICTS, FLAGS, canonical, sha256Hex } from './common.js';

const id = location.pathname.match(/^\/r\/([A-Za-z0-9_-]{12})\/?$/)?.[1];
const main = $('#main');
main.setAttribute('aria-busy', 'true');
let downloadUrl;

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function externalLink(url, text, attrs = {}) {
  const href = safeUrl(url);
  return href ? h('a', { ...attrs, href, target: '_blank', rel: 'noopener noreferrer' }, text) : h('span', attrs, text);
}

function claimCard(c) {
  const flags = Array.isArray(c.flags) ? c.flags : [];
  const rows = Array.isArray(c.rows) ? c.rows : [];
  const scope = c.scope || { retired_total: 0, top: [] };
  const roundingShortfall = c.verdict === 'backed' && c.claimed > 0 && c.backed < c.claimed;
  const displayVerdict = roundingShortfall ? 'partly_backed' : c.verdict;
  const v = VERDICTS[displayVerdict];
  const p = c.project;
  const title = p ? `${p.name || p.id} (${p.id})` : flags.includes('company_wide') ? 'Company-wide total' : c.project_lookup?.wanted || 'Project';
  const scopeBits = [c.input?.vintage && `Credit vintage: ${c.input.vintage}`, c.input?.year && `Retirement year: ${c.input.year}`].filter(Boolean).join(' · ');
  const quantified = c.claimed !== null && c.claimed !== undefined;
  const pct = c.claimed > 0 ? Math.max(0, Math.min(100, (c.backed / c.claimed) * 100)) : 0;
  const zeroClaim = quantified && c.claimed === 0;
  const knownFlags = flags.filter((f) => FLAGS[f]);
  const matchedOn = { beneficiary: 'Beneficiary name', account: 'Retiring account', note: 'Retirement note' };
  return h('article', { class: 'card claim', 'aria-labelledby': `claim-${c.n}` },
    h('div', { class: 'claim-head' },
      h('div', {}, h('h2', { id: `claim-${c.n}` }, `Claim ${c.n}: ${title}`),
        h('p', { class: 'meta' }, [p && [registryName(p.registry), p.country, p.type].filter(Boolean).join(' · '), scopeBits || 'All credit vintages and retirement years'].filter(Boolean).join(' — '))),
      zeroClaim ? h('span', { class: 'verdict v-info' }, 'No tonnes claimed') : verdictBadge(displayVerdict)),
    h('div', { class: 'claim-body' },
      h('p', {}, zeroClaim ? 'This saved report specified zero tonnes. It does not establish backing for a positive carbon-offset claim.' : v ? v.say(c) : 'Review the matching retirement details below.'),
      h('div', { class: 'figures' },
        h('div', {}, h('div', { class: 'k' }, 'Claimed'), h('div', { class: 'v' }, quantified ? t(c.claimed) : 'Amount not specified')),
        h('div', {}, h('div', { class: 'k' }, quantified ? 'Matched to this claim' : 'Matching tonnes'), h('div', { class: 'v' }, t(c.backed))),
        c.gap > 0 ? h('div', {}, h('div', { class: 'k' }, 'Without matching evidence'), h('div', { class: 'v' }, t(c.gap))) : null),
      c.claimed > 0 ? h('div', {},
        h('p', { class: 'small hint' }, `${n(pct)}% of the claimed amount matched in the snapshot`),
        h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${pct}%` }))) : null,
      roundingShortfall ? h('p', { class: 'note warn' }, 'This older report accepted a small rounding shortfall. The figures above show the full amount without matching evidence.') : null,
      knownFlags.length ? h('ul', { class: 'flags' }, knownFlags.map((f) => h('li', { class: FLAGS[f][0] }, FLAGS[f][1]))) : null,
      c.project_lookup?.candidates?.length ? h('p', { class: 'note warn' }, `${p ? 'Other projects also matched that name' : 'The project name matches more than one entry'}: ${c.project_lookup.candidates.map((x) => `${x.name || x.project_id} (${x.project_id})`).join('; ')}. ${p ? 'Review the selected project before relying on this result.' : 'Choose “Review or change inputs” above and use the exact project ID to check the right entry.'}`) : null,
      rows.length ? h('details', { open: rows.length <= 5 },
        h('summary', {}, `Retirements used for this claim (${n(c.rows_total ?? rows.length)} rows)`),
        c.rows_total > rows.length ? h('p', { class: 'small hint', style: 'margin-bottom:10px' }, `Showing ${n(rows.length)} of ${n(c.rows_total)} rows. The JSON download contains the full allocation of row IDs and tonnes.`) : null,
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('caption', { class: 'sr-only' }, `Registry retirement evidence for claim ${c.n}`),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Row / project'), h('th', { scope: 'col' }, 'Retired / vintage'), h('th', { class: 'r', scope: 'col' }, 'Used here'), h('th', { class: 'r', scope: 'col' }, 'Row total'), h('th', { scope: 'col' }, 'Registry names'), h('th', { scope: 'col' }, 'Name found in'))),
          h('tbody', {}, rows.map((r) => h('tr', {},
            h('td', {}, h('span', { class: 'mono' }, `#${r.id}`), h('div', { class: 'small hint' }, r.project_id || p?.id || 'Project not recorded')),
            h('td', {}, day(r.retired_on), h('div', { class: 'small hint' }, r.vintage ? `Vintage ${r.vintage}` : 'Vintage not recorded')),
            h('td', { class: 'r' }, t(r.used)), h('td', { class: 'r' }, t(r.quantity)),
            h('td', {}, r.shown_as ? `Beneficiary: ${r.shown_as}` : 'Beneficiary not recorded',
              r.account ? h('div', { class: 'hint small' }, `Retiring account: ${r.account}`) : null,
              r.note ? h('div', { class: 'hint small' }, `Note: ${r.note}`) : null), h('td', {}, matchedOn[r.matched_on] || 'Not recorded'))))))) : null,
      scope.top?.length ? h('details', {},
        h('summary', {}, `Other context: ${t(scope.retired_total)} retired across this scope`),
        h('p', { class: 'small hint', style: 'margin-bottom:10px' }, `The ${scope.top.length} largest beneficiary entries are shown below, including any matching claimant. These totals include retirements for other organisations and do not add to this claim's backing.`),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('caption', { class: 'sr-only' }, 'Largest beneficiaries across the selected project, vintage and retirement year'),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Beneficiary in registry'), h('th', { class: 'r', scope: 'col' }, 'Tonnes'), h('th', { class: 'r', scope: 'col' }, 'Retirements'))),
          h('tbody', {}, scope.top.map((x) => h('tr', {}, h('td', {}, x.name || 'Beneficiary not recorded'), h('td', { class: 'r' }, t(x.tonnes)), h('td', { class: 'r' }, n(x.retirements)))))))) : null,
      safeUrl(p?.url) ? h('p', { class: 'small' }, externalLink(p.url, `View ${p.id} at ${registryName(p.registry) || 'the registry'} ↗`)) : null));
}

function chainPanel(data) {
  const { anchor, ledger, chain } = data;
  const box = h('section', { class: 'card card-pad section', 'aria-labelledby': 'chain-h' },
    h('h2', { id: 'chain-h' }, 'Optional blockchain record'),
    h('p', { class: 'hint', style: 'margin-top:8px' }, 'This feature uses Base Sepolia, a test network. It records this report and checks competing allocations within the TrueTonne ledger. It does not verify company identity or prevent claims elsewhere.'));
  if (!chain) {
    box.append(h('p', { class: 'note', style: 'margin-top:12px' }, 'Blockchain recording is unavailable. Your saved report and JSON download remain available.'));
    return box;
  }
  const allocated = new Set(data.report.claims.flatMap((c) => (c.allocation || []).filter((row) => row[1] > 0).map((row) => row[0]))).size;
  const maxRows = chain.max_rows || 80;
  const others = (ledger?.rows || []).filter((r) => r.read_ok && r.held_by_others > 0);
  if (ledger?.anchored_block && (!anchor || anchor.status === 'pending')) {
    box.append(h('p', { class: 'note ok', style: 'margin-top:12px' }, 'The report hash is already recorded on Base Sepolia in ',
      externalLink(`${chain.explorer}/block/${ledger.anchored_block}`, `block ${n(ledger.anchored_block)} ↗`), '.'));
    box.append(h('p', { class: 'hint', style: 'margin-top:12px' }, 'The transaction receipt is unavailable on this server, so accepted and blocked retirement allocations cannot be displayed. The hash record alone does not confirm that every allocation was accepted.'));
  } else if (anchor?.status === 'pending') {
    const fallbackMessage = anchor.tx ? 'A transaction was submitted, but confirmation is still pending. No retirement allocation is confirmed by this page yet. '
      : anchor.stage === 'unknown' ? 'This recording request was interrupted before a transaction link could be saved. Submission could not be confirmed.'
      : 'Your recording request is being submitted. No retirement allocation is confirmed yet. Check its status again shortly.';
    box.append(h('p', { class: 'note warn', style: 'margin-top:12px' }, anchor.message || fallbackMessage,
    anchor.tx ? externalLink(anchor.url || `${chain.explorer}/tx/${anchor.tx}`, 'View submitted transaction ↗') : null));
    if (anchor.stage === 'unknown') box.append(h('p', { class: 'hint', style: 'margin-top:12px' }, 'Your registry report is saved. ',
      h('a', { href: `/?edit=${id}` }, 'Review the inputs to create a new report'), ' if you need to start again.'));
    if (anchor.rows_skipped > 0) box.append(h('p', { class: 'hint', style: 'margin-top:12px' }, `${n(anchor.rows_skipped)} backing rows were omitted because each transaction is limited to ${n(maxRows)} rows.`));
    const refresh = h('button', { class: 'btn', type: 'button', style: 'margin-top:14px' }, 'Check recording status');
    const status = h('p', { class: 'small hint', role: 'status', 'aria-live': 'polite', style: 'margin-top:12px' });
    refresh.addEventListener('click', async () => {
      busy(refresh, true, 'Checking status…');
      try { renderReport(await api(`/api/report/${id}`)); }
      catch (e) { status.textContent = e.message; }
      finally { busy(refresh, false); }
    });
    box.append(refresh, status);
  } else if (anchor?.status === 'failed') {
    box.append(h('p', { class: 'note bad', style: 'margin-top:12px' }, 'The blockchain transaction failed. No allocation was recorded by this transaction. Your registry report remains saved. ',
      externalLink(anchor.url || `${chain.explorer}/tx/${anchor.tx}`, 'View failed transaction ↗')));
  } else if (anchor) {
    box.append(h('p', { style: 'margin-top:12px' }, 'Report recorded on ', externalLink(anchor.url || `${chain.explorer}/tx/${anchor.tx}`, 'Base Sepolia ↗'), anchor.block ? ` in block ${n(anchor.block)}.` : '.'));
    if (anchor.blocked?.length) box.append(h('div', { class: 'note bad', style: 'margin-top:12px' }, h('b', {}, 'Some allocations were blocked. '),
      `The testnet ledger refused ${n(anchor.blocked.length)} retirement row${anchor.blocked.length > 1 ? 's' : ''} because another claimant already reserved enough tonnes to exceed the row's capacity. This does not change the registry matches above.`,
      h('ul', {}, anchor.blocked.map((b) => h('li', {}, `Row #${b.row}: requested ${t(b.requested)}; other claimants hold ${t(b.held_by_others)} of the ${t(b.cap)} capacity.`)))));
    if (anchor.claimed?.length) box.append(h('div', { class: 'note ok', style: 'margin-top:12px' }, `The testnet ledger accepted ${t(anchor.claimed.reduce((sum, row) => sum + row.tonnes, 0))} across ${n(anchor.claimed.length)} row${anchor.claimed.length > 1 ? 's' : ''} for this claimant. Repeated checks for the same claimant can reuse its existing reservation.`));
    if (!anchor.claimed?.length && !anchor.blocked?.length) box.append(h('p', { class: 'hint', style: 'margin-top:12px' }, 'The report hash was recorded without any retirement allocation.'));
    if (anchor.rows_skipped > 0) box.append(h('p', { class: 'note warn', style: 'margin-top:12px' }, `${n(anchor.rows_skipped)} backing rows were not submitted because each transaction is limited to ${n(maxRows)} rows. This record covers only the submitted rows.`));
  } else if (!allocated) {
    box.append(h('p', { class: 'note', style: 'margin-top:12px' }, 'There are no matching tonnes to reserve in the testnet ledger. The registry result above is already saved.'));
  } else if (chain.can_record === false) {
    box.append(h('p', { class: 'note', style: 'margin-top:12px' }, 'New blockchain records are currently unavailable. The registry result above is already saved.'));
  } else {
    box.append(h('p', { class: 'hint', style: 'margin-top:12px' }, 'Recording submits this report hash and its matching retirement rows to the testnet ledger. No wallet or payment is required. Allow up to a minute for confirmation.'));
    if (!ledger || ledger.rows?.some((r) => !r.read_ok)) box.append(h('p', { class: 'note warn', style: 'margin-top:12px' }, 'Current ledger availability could not be fully checked. The contract will check each submitted row when recording.'));
    if (others.length) box.append(h('p', { class: 'note warn', style: 'margin-top:12px' }, `Other claimants have reservations on ${n(others.length)} matching row${others.length > 1 ? 's' : ''}. The contract will refuse any allocation that exceeds the remaining capacity.`));
    if (allocated > maxRows) box.append(h('p', { class: 'note warn', style: 'margin-top:12px' }, `This report uses ${n(allocated)} rows. Only the first ${n(maxRows)} can be submitted; ${n(allocated - maxRows)} rows will remain outside this blockchain record.`));
    const btn = h('button', { class: 'btn', type: 'button', style: 'margin-top:14px' }, 'Record on test network');
    const msg = h('div', { class: 'note bad', role: 'alert', tabindex: '-1', hidden: true, style: 'margin-top:12px' });
    const statusBtn = h('button', { class: 'btn', type: 'button', hidden: true, style: 'margin-top:14px' }, 'Check recording status');
    const statusNote = h('p', { style: 'margin-top:8px', role: 'status', 'aria-live': 'polite' });
    statusBtn.addEventListener('click', async () => {
      busy(statusBtn, true, 'Checking status…');
      try {
        const latest = await api(`/api/report/${id}`);
        if (latest.anchor || latest.ledger?.anchored_block) renderReport(latest);
        else statusNote.textContent = 'The report record is not confirmed yet. Check the transaction link and try the status check again shortly.';
      } catch (e) {
        statusNote.textContent = e.message;
      } finally { busy(statusBtn, false); }
    });
    btn.addEventListener('click', async () => {
      msg.hidden = true;
      busy(btn, true, 'Waiting for confirmation…');
      try {
        const result = await api(`/api/report/${id}/anchor`, { method: 'POST' });
        renderReport({ ...data, anchor: result });
        $('#chain-h')?.scrollIntoView({ block: 'center' });
      } catch (e) {
        msg.replaceChildren(e.message);
        if (e.data?.tx) {
          msg.append(' ', externalLink(e.data.url || `${chain.explorer}/tx/${e.data.tx}`, 'View submitted transaction ↗'),
            h('p', { style: 'margin-top:8px' }, 'A transaction was submitted. Check its status before attempting another recording.'), statusNote);
          btn.hidden = true;
          statusBtn.hidden = false;
        }
        msg.hidden = false;
        msg.focus();
      } finally { busy(btn, false); }
    });
    box.append(btn, msg, statusBtn);
  }
  box.append(h('p', { class: 'small hint', style: 'margin-top:12px' }, 'Testnet contract: ', externalLink(chain.ledger_url, chain.ledger, { class: 'hash' })));
  return box;
}

function proofPanel(data) {
  const out = h('p', { class: 'small', role: 'status', 'aria-live': 'polite', hidden: true, style: 'margin-top:12px' });
  const btn = h('button', { class: 'btn', type: 'button' }, 'Verify report hash');
  btn.addEventListener('click', async () => {
    busy(btn, true, 'Verifying…');
    try {
      const mine = await sha256Hex(canonical(data.report));
      out.textContent = mine === data.hash ? 'Hash matches: this report matches the saved SHA-256 fingerprint. This checks file integrity, not the accuracy of the underlying claim.' : 'Hash does not match. Reload the report before relying on it.';
      out.className = `note ${mine === data.hash ? 'ok' : 'bad'}`;
    } catch {
      out.textContent = 'Hash verification is unavailable in this browser. Download the JSON to check its canonical SHA-256 hash with another tool.';
      out.className = 'note warn';
    } finally { out.hidden = false; busy(btn, false); }
  });
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(data.report, null, 2)], { type: 'application/json' }));
  const dl = h('a', { class: 'btn', download: `truetonne-${id}.json`, href: downloadUrl }, 'Download full report (JSON)');
  return h('section', { class: 'card card-pad section', 'aria-labelledby': 'proof-h' }, h('h2', { id: 'proof-h' }, 'Save and verify this report'),
    h('p', { class: 'hint', style: 'margin-top:8px' }, 'The JSON contains the reviewed inputs, registry results and full row allocations. The hash is a fingerprint of that file.'),
    h('details', { style: 'margin:12px 0' }, h('summary', {}, 'Report and dataset fingerprints'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Report SHA-256'), h('dd', { class: 'hash' }, data.hash),
        h('dt', {}, 'Dataset'), h('dd', {}, `${data.report.dataset.source}, ${day(data.report.dataset.generated_at)}`),
        h('dt', {}, 'Dataset SHA-256'), h('dd', { class: 'hash' }, data.report.dataset.zip_sha256))),
    h('div', { class: 'actions' }, dl, btn), out);
}

function renderReport(data) {
  const r = data.report;
  if (!r || !Array.isArray(r.claims) || !r.claims.length || !r.dataset || !r.summary || typeof r.claimant !== 'string') throw new Error('This report could not be read. Try reloading it or run a new check.');
  const quantified = r.claims.filter((c) => c.claimed !== null && c.claimed !== undefined);
  const discoveries = r.claims.filter((c) => c.claimed === null || c.claimed === undefined);
  const found = discoveries.reduce((sum, c) => sum + (c.backed || 0), 0);
  const hasAmount = quantified.length > 0;
  const companyQuery = new URLSearchParams({ name: r.claimant });
  for (const alias of r.aliases || []) companyQuery.append('alias', alias);
  document.title = `${r.claimant}: registry check · TrueTonne`;
  main.setAttribute('aria-busy', 'false');
  main.replaceChildren(
    h('section', { class: 'hero' }, h('p', { class: 'hint' }, `Saved claim check · ${day(r.created_at)}`), h('h1', {}, r.claimant),
      h('p', { class: 'lede' }, hasAmount ? `${t(r.summary.tonnes_backed)} of ${t(r.summary.tonnes_claimed)} claimed matched registry retirements naming this claimant.` : `${t(found)} matched registry retirements naming this claimant. No claimed amount was supplied, so this is a lookup rather than a comparison.`),
      hasAmount && discoveries.length ? h('p', { class: 'hint', style: 'margin-top:10px' }, `${n(discoveries.length)} additional claim${discoveries.length > 1 ? 's had' : ' had'} no amount to compare; ${t(found)} found for those entries is excluded from the claimed and backed totals.`) : null,
      h('div', { class: 'actions', style: 'margin-top:20px' },
        h('a', { class: 'btn', href: `/?edit=${id}` }, 'Review or change inputs'),
        h('a', { href: '/' }, 'Check another claim'),
        h('a', { href: `/company.html?${companyQuery}` }, 'Look up this company'))),
    h('p', { class: 'note warn', style: 'margin-bottom:20px' }, `This checks name matches in a registry snapshot dated ${day(r.dataset.generated_at)}. It does not establish project quality, ownership or carbon neutrality. `, h('a', { href: '/docs.html' }, 'Understand the limits.')),
    h('div', { class: 'summary', 'aria-label': 'Report totals' },
      h('div', {}, h('div', { class: 'k' }, 'Claims reviewed'), h('div', { class: 'v' }, n(r.claims.length))),
      h('div', {}, h('div', { class: 'k' }, 'Tonnes claimed'), h('div', { class: 'v' }, hasAmount ? t(r.summary.tonnes_claimed) : 'Not specified')),
      h('div', {}, h('div', { class: 'k' }, hasAmount ? 'Matched to stated amounts' : 'Matching tonnes'), h('div', { class: 'v' }, t(hasAmount ? r.summary.tonnes_backed : found))),
      h('div', {}, h('div', { class: 'k' }, 'Snapshot date'), h('div', { class: 'v', style: 'font-size:1.05rem' }, day(r.dataset.generated_at)))),
    h('div', { class: 'report-grid' },
      h('div', { class: 'report-main' },
        ...r.claims.map(claimCard),
        ...(r.source_text ? [h('details', { class: 'section card card-pad' }, h('summary', {}, 'Original text supplied for this check'), h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, r.source_text))] : [])),
      h('aside', { class: 'report-aside', 'aria-label': 'Verification' }, proofPanel(data), chainPanel(data))));
}

async function render() {
  if (!id) {
    main.setAttribute('aria-busy', 'false');
    main.replaceChildren(h('section', { class: 'hero' }, h('h1', {}, 'Open a saved report link'), h('p', { class: 'lede' }, 'A report link includes its ID, such as /r/ followed by 12 characters. Check the link you received, or start a new claim check.'), h('a', { class: 'btn btn-primary', href: '/', style: 'margin-top:20px' }, 'Check a claim')));
    return;
  }
  try { renderReport(await api(`/api/report/${id}`)); } catch (e) {
    main.setAttribute('aria-busy', 'false');
    const missing = e.status === 404 || e.message === 'No report with that ID.';
    const retry = h('button', { class: 'btn', type: 'button' }, 'Try loading again');
    retry.addEventListener('click', async () => {
      busy(retry, true, 'Loading report…');
      main.setAttribute('aria-busy', 'true');
      await render();
    });
    main.replaceChildren(h('section', { class: 'hero' }, h('h1', {}, missing ? 'Report not found' : 'Report could not load'),
      h('p', { class: 'lede', role: 'alert' }, missing ? 'There is no saved report at this link. Check that you copied the complete address.' : e.message),
      h('div', { class: 'actions', style: 'margin-top:20px' }, missing ? null : retry, h('a', { class: 'btn btn-primary', href: '/' }, 'Start a new check'))));
  }
}

window.addEventListener('pagehide', (event) => { if (downloadUrl && !event.persisted) URL.revokeObjectURL(downloadUrl); });
render();
