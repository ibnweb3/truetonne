// The check: does the registry snapshot back each claimed tonne, and is any tonne used twice?
// Works on any D1-shaped db (prepare/bind/all/first), so tests run it on local SQLite.

import { normalizeProjectId, normalizeName, nameVariants } from './names.js';

export const MAX_CLAIMS = 12;
const ROWS_IN_REPORT = 60; // backing rows listed per claim; allocation still uses all of them
const MATCH_LIMIT = 5000;  // matched rows fetched per name variant

const COLS = 'r.id, r.project_id, r.vintage, r.quantity, r.shown_as, r.account, r.note, r.reason, r.retired_on';

const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const round = (n) => Math.round(n * 1000) / 1000;
// A few snapshot fields hold literal \u escapes ("N₂O"); show the character instead.
const unescape = (s) => (s == null ? s : String(s).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));

export async function getDataset(db) {
  return first(db, 'SELECT source, generated_at, zip_sha256, projects, retirements FROM dataset WHERE id = 1');
}

export function validateCompanyNames(rawName, rawAliases = []) {
  const errors = [];
  const claimant = typeof rawName === 'string' ? rawName.trim() : '';
  if (claimant.length > 120 || normalizeName(claimant).replace(/ /g, '').length < 3) {
    errors.push('Enter a company name between 3 and 120 characters, including at least 3 Latin letters or numbers.');
  }
  if (!Array.isArray(rawAliases) || rawAliases.some((alias) => typeof alias !== 'string')) {
    errors.push('Other company names must be text, one name per entry.');
  }
  const aliases = Array.isArray(rawAliases) ? rawAliases.filter((a) => typeof a === 'string').map((a) => a.trim()).filter(Boolean) : [];
  if (aliases.length > 4) errors.push('Enter at most four other company names.');
  if (aliases.some((alias) => alias.length > 120 || normalizeName(alias).replace(/ /g, '').length < 3)) {
    errors.push('Each other company name must contain between 3 and 120 characters, including at least 3 Latin letters or numbers.');
  }
  return { errors, claimant, aliases };
}

function cleanClaim(c = {}) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) c = {};
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (!['string', 'number'].includes(typeof v)) return NaN;
    const text = String(v).trim();
    if (!text) return null;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return NaN;
    const n = Number(text.replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const year = (v) => {
    const n = num(v);
    return n === null ? null : Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : NaN;
  };
  return {
    project_id: typeof c.project_id === 'string' ? c.project_id.trim() || null : null,
    project_name: typeof c.project_name === 'string' ? c.project_name.trim() || null : null,
    vintage: year(c.vintage),
    tonnes: num(c.tonnes),
    year: year(c.year),
  };
}

export function validateInput(body) {
  const { errors, claimant, aliases } = validateCompanyNames(body?.claimant, body?.aliases ?? []);
  const raw = Array.isArray(body?.claims) ? body.claims : [];
  if (!raw.length) errors.push('Add at least one claim.');
  if (raw.length > MAX_CLAIMS) errors.push(`At most ${MAX_CLAIMS} claims per check.`);
  const claims = raw.slice(0, MAX_CLAIMS).map(cleanClaim);
  claims.forEach((c, i) => {
    const n = i + 1;
    if (raw[i]?.project_id != null && typeof raw[i].project_id !== 'string') errors.push(`Claim ${n}: project ID must be text.`);
    if (raw[i]?.project_name != null && typeof raw[i].project_name !== 'string') errors.push(`Claim ${n}: project name must be text.`);
    if (c.project_id?.length > 40) errors.push(`Claim ${n}: use at most 40 characters for the project ID.`);
    if (c.project_name?.length > 160) errors.push(`Claim ${n}: use at most 160 characters for the project name.`);
    if (Number.isNaN(c.tonnes) || (c.tonnes !== null && (c.tonnes <= 0 || c.tonnes > Number.MAX_SAFE_INTEGER / 1000))) errors.push(`Claim ${n}: tonnes must be a positive number within the supported range.`);
    else if (c.tonnes !== null && Math.abs(c.tonnes * 1000 - Math.round(c.tonnes * 1000)) > 0.00001) errors.push(`Claim ${n}: use at most three decimal places for tonnes.`);
    if (Number.isNaN(c.vintage)) errors.push(`Claim ${n}: vintage must be a year like 2019.`);
    if (Number.isNaN(c.year)) errors.push(`Claim ${n}: retirement year must be a year like 2023.`);
    if (c.vintage && c.year && c.vintage > c.year) errors.push(`Claim ${n}: retirement year cannot be earlier than the credit vintage.`);
    if (c.project_id && !normalizeProjectId(c.project_id)) errors.push(`Claim ${n}: "${c.project_id}" is not a project ID we recognise (try VCS1477, GS1247, CAR1335, ACR123).`);
    if (!c.project_id && !c.project_name && c.tonnes === null) errors.push(`Claim ${n}: give a project, or at least the tonnes claimed.`);
  });
  return { errors, input: { claimant, aliases, claims } };
}

async function resolveProject(db, claim) {
  const id = normalizeProjectId(claim.project_id);
  if (id) {
    const p = await first(db, 'SELECT * FROM projects WHERE project_id = ?', id);
    return { project: p, resolved_by: 'id', wanted: id, candidates: [] };
  }
  if (!claim.project_name) return { project: null, resolved_by: null, wanted: null, candidates: [] };
  const words = normalizeName(claim.project_name).split(' ').filter((w) => w.length > 1).slice(0, 8);
  if (!words.length) return { project: null, resolved_by: 'name', wanted: claim.project_name, candidates: [] };
  const q = words.map((w) => `"${w}"`).join(' AND ');
  const hits = await all(db, `SELECT p.project_id, p.name, p.registry, p.country FROM projects_fts f
    JOIN projects p ON p.rowid = f.rowid WHERE projects_fts MATCH ? ORDER BY rank LIMIT 5`, q);
  // An ambiguous name must never silently select a different project's evidence.
  const project = hits.length === 1 ? await first(db, 'SELECT * FROM projects WHERE project_id = ?', hits[0].project_id) : null;
  return { project, resolved_by: 'name', wanted: claim.project_name, candidates: hits };
}

function scopeSql(claim, projectId) {
  const where = [];
  const args = [];
  if (projectId) { where.push('r.project_id = ?'); args.push(projectId); }
  if (claim.vintage) { where.push('r.vintage = ?'); args.push(claim.vintage); }
  if (claim.year) { where.push("substr(r.retired_on, 1, 4) = ?"); args.push(String(claim.year)); }
  return { where, args };
}

async function matchedRows(db, variants, claim, projectId) {
  const byId = new Map();
  let limited = false;
  for (const v of variants) {
    const { where, args } = scopeSql(claim, projectId);
    // The index stores the source text. An ampersand is a separator there, but
    // normalizeName treats it as "and". Fetch both spellings, then verify the
    // normalized phrase inside one source field below.
    const words = v.split(' ').filter((word) => word !== 'and');
    const search = words.length && v.split(' ').includes('and')
      ? words.map((word) => `"${word}"`).join(' AND ')
      : `"${v}"`;
    const rows = await all(db, `SELECT ${COLS} FROM retirements_fts f JOIN retirements r ON r.id = f.rowid
      WHERE retirements_fts MATCH ? ${where.map((w) => 'AND ' + w).join(' ')}
      ORDER BY r.retired_on, r.id LIMIT ${MATCH_LIMIT}`, search, ...args);
    if (rows.length >= MATCH_LIMIT) limited = true;
    for (const r of rows) {
      const matchedOn = whereMatched(r, v);
      // FTS phrases can span two concatenated fields. Require a real field-level match.
      if (matchedOn && !byId.has(r.id)) byId.set(r.id, { ...r, matched_on: matchedOn });
    }
  }
  return Object.assign([...byId.values()].sort((a, b) => (a.retired_on || '').localeCompare(b.retired_on || '') || a.id - b.id), { limited });
}

// Which field named the claimant: the registry beneficiary field, the account holder, or only the free-text note.
function whereMatched(r, variant) {
  const has = (s) => s && ` ${normalizeName(s)} `.includes(` ${variant} `);
  if (has(r.shown_as)) return 'beneficiary';
  if (has(r.account)) return 'account';
  if (has(r.note)) return 'note';
  return null;
}

async function othersInScope(db, claim, projectId) {
  const { where, args } = scopeSql(claim, projectId);
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = await first(db, `SELECT COUNT(*) n, COALESCE(SUM(r.quantity), 0) t FROM retirements r ${w}`, ...args);
  const top = await all(db, `SELECT COALESCE(r.shown_as, '') who, SUM(r.quantity) t, COUNT(*) n FROM retirements r ${w}
    GROUP BY who ORDER BY t DESC LIMIT 6`, ...args);
  return {
    retired_total: round(total?.t || 0),
    retirements: total?.n || 0,
    top: top.map((x) => ({ name: x.who || null, tonnes: round(x.t), retirements: x.n })),
  };
}

function verdictFor({ claimed, backed, matched, scopeTotal, project, wantsProject }) {
  if (wantsProject && !project) return 'project_not_found';
  if (claimed === null) return backed > 0 ? 'found' : matched > 0 ? 'used_by_earlier_claim' : scopeTotal > 0 ? 'not_attributed' : 'no_retirements';
  if (round(backed) >= claimed) return 'backed';
  if (backed > 0) return 'partly_backed';
  if (matched > 0) return 'used_by_earlier_claim';
  return scopeTotal > 0 ? 'not_attributed' : 'no_retirements';
}

export async function runCheck(db, input, { now = new Date() } = {}) {
  const dataset = await getDataset(db);
  if (!dataset) throw Object.assign(new Error('Registry data is not available right now. Please try again later.'), { status: 503 });
  const variants = nameVariants(input.claimant, input.aliases);
  const snapshotYear = Number(String(dataset.generated_at).slice(0, 4));
  const remaining = new Map(); // retirement row id -> tonnes not yet used by an earlier claim in this report
  const claims = [];

  for (const [i, claim] of input.claims.entries()) {
    const wantsProject = Boolean(claim.project_id || claim.project_name);
    const res = await resolveProject(db, claim);
    const projectId = res.project?.project_id || null;
    const flags = [];
    let matched = [];
    let scope = { retired_total: 0, retirements: 0, top: [] };
    let pv = null;

    if (!wantsProject || projectId) {
      matched = await matchedRows(db, variants, claim, projectId);
      scope = await othersInScope(db, claim, projectId);
      if (projectId && claim.vintage) {
        pv = await first(db, 'SELECT issued, retired, n_retirements FROM pv_stats WHERE project_id = ? AND vintage = ?', projectId, claim.vintage);
      }
    }

    const matchedTotal = matched.reduce((s, r) => s + r.quantity, 0);
    const need = claim.tonnes === null ? Infinity : claim.tonnes;
    let backed = 0;
    const used = [];
    for (const r of matched) {
      if (backed >= need) break;
      const left = remaining.has(r.id) ? remaining.get(r.id) : r.quantity;
      if (left <= 0) continue;
      const take = Math.min(left, need - backed);
      remaining.set(r.id, left - take);
      backed += take;
      used.push({ r, take });
    }

    const verdict = !res.project && res.candidates.length > 1 ? 'project_ambiguous'
      : verdictFor({ claimed: claim.tonnes, backed, matched: matchedTotal, scopeTotal: scope.retired_total, project: res.project, wantsProject });

    if (res.resolved_by === 'name' && res.project) flags.push('project_matched_by_name');
    if (pv && pv.issued > 0 && pv.retired > pv.issued * 1.001) flags.push('retired_exceeds_issued');
    if (pv && pv.issued === 0 && pv.retired > 0) flags.push('no_issuance_recorded');
    if (claim.year && claim.year > snapshotYear) flags.push('after_snapshot');
    else if (claim.year === snapshotYear) flags.push('partial_snapshot_year');
    if (used.some(({ r }) => r.matched_on === 'note')) flags.push('named_only_in_note');
    const thirdParty = used.filter(({ r }) => /third party/i.test(r.reason || ''));
    if (thirdParty.some(({ r }) => r.matched_on === 'account')) flags.push('claimant_retired_for_someone_else');
    else if (thirdParty.length) flags.push('retired_by_intermediary');
    if (matched.limited) flags.push('match_limit_reached');
    if (claim.tonnes !== null && matchedTotal > backed && backed < need) flags.push('rows_shared_with_earlier_claim');
    if (!wantsProject) flags.push('company_wide');

    claims.push({
      n: i + 1,
      input: claim,
      project: res.project ? {
        id: res.project.project_id, name: res.project.name, registry: res.project.registry, country: res.project.country,
        type: unescape(res.project.project_type), category: res.project.category, status: res.project.status, url: res.project.url,
      } : null,
      project_lookup: { resolved_by: res.resolved_by, wanted: res.wanted, candidates: res.project ? res.candidates.slice(1) : res.candidates },
      verdict,
      claimed: claim.tonnes,
      backed: round(backed),
      gap: claim.tonnes === null ? null : round(Math.max(0, claim.tonnes - backed)),
      matched_total: round(matchedTotal),
      matched_retirements: matched.length,
      vintage_stats: pv ? { issued: round(pv.issued), retired: round(pv.retired), retirements: pv.n_retirements } : null,
      scope,
      flags,
      rows: used.slice(0, ROWS_IN_REPORT).map(({ r, take }) => ({
        id: r.id, project_id: r.project_id, vintage: r.vintage, retired_on: r.retired_on, quantity: round(r.quantity),
        used: round(take), shown_as: r.shown_as, account: r.account, reason: r.reason, matched_on: r.matched_on,
        // A note is only shown because it names the claimant the user typed in.
        note: r.matched_on === 'note' ? r.note : null,
      })),
      rows_total: used.length,
      allocation: used.map(({ r, take }) => [r.id, round(take), round(r.quantity)]),
    });
  }

  const claimed = claims.reduce((s, c) => s + (c.claimed || 0), 0);
  const backed = claims.reduce((s, c) => s + (c.claimed === null ? 0 : Math.min(c.backed, c.claimed)), 0);
  return {
    v: 1,
    kind: 'truetonne.check',
    created_at: now.toISOString(),
    dataset: { source: dataset.source, generated_at: dataset.generated_at, zip_sha256: dataset.zip_sha256 },
    claimant: input.claimant,
    claimant_key: normalizeName(input.claimant),
    aliases: input.aliases,
    claims,
    summary: {
      claims: claims.length,
      tonnes_claimed: round(claimed),
      tonnes_backed: round(backed),
      verdicts: claims.reduce((m, c) => ((m[c.verdict] = (m[c.verdict] || 0) + 1), m), {}),
    },
  };
}

// Company profile: everything in the snapshot that names this organisation, by year and project.
export async function companyProfile(db, name, aliases = []) {
  const variants = nameVariants(name, aliases);
  if (!variants.length) return null;
  const dataset = await getDataset(db);
  if (!dataset) throw Object.assign(new Error('Registry data is not available right now. Please try again later.'), { status: 503 });
  const rows = await matchedRows(db, variants, { vintage: null, year: null }, null);
  const byYear = {};
  const byProject = {};
  for (const r of rows) {
    const y = r.retired_on ? r.retired_on.slice(0, 4) : 'unknown';
    byYear[y] = round((byYear[y] || 0) + r.quantity);
    byProject[r.project_id] = round((byProject[r.project_id] || 0) + r.quantity);
  }
  const ids = Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const names = ids.length ? await all(db, `SELECT project_id, name, registry, country FROM projects WHERE project_id IN (${ids.map(() => '?').join(',')})`, ...ids.map((x) => x[0])) : [];
  const nameOf = Object.fromEntries(names.map((p) => [p.project_id, p]));
  return {
    name, variants,
    dataset,
    retirements: rows.length,
    tonnes: round(rows.reduce((s, r) => s + r.quantity, 0)),
    limited: rows.limited,
    by_year: Object.entries(byYear).sort((a, b) => a[0].localeCompare(b[0])).map(([year, tonnes]) => ({ year, tonnes })),
    top_projects: ids.map(([id, tonnes]) => ({ id, tonnes, ...(nameOf[id] ? { name: nameOf[id].name, registry: nameOf[id].registry, country: nameOf[id].country } : {}) })),
    matched_on: rows.reduce((m, r) => ((m[r.matched_on] = (m[r.matched_on] || 0) + 1), m), {}),
  };
}
