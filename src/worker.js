import { validateInput, runCheck, companyProfile, getDataset } from './check.js';
import { extractClaims, MAX_TEXT } from './extract.js';
import { reportHash } from './hash.js';
import { normalizeProjectId } from './names.js';
import { anchorReport, chainInfo, ledgerStatus } from './chain.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const fail = (status, error, extra = {}) => json({ error, ...extra }, status);

// Fixed-window limit per client IP, stored in D1. Returns true when the call is allowed.
async function allow(env, req, bucket, max, windowSec) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const k = `${bucket}:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT n, reset_at FROM rate WHERE k = ?').bind(k).first();
  if (!row || row.reset_at <= now) {
    await env.DB.prepare('INSERT OR REPLACE INTO rate (k, n, reset_at) VALUES (?, 1, ?)').bind(k, now + windowSec).run();
    return true;
  }
  if (row.n >= max) return false;
  await env.DB.prepare('UPDATE rate SET n = n + 1 WHERE k = ?').bind(k).run();
  return true;
}

async function readJson(req, maxBytes = 32_000) {
  const text = await req.text();
  if (text.length > maxBytes) throw new Error('Request is too large.');
  try { return JSON.parse(text || '{}'); } catch { throw new Error('Request body must be JSON.'); }
}

const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
};

async function loadReport(env, id) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) return null;
  return env.DB.prepare('SELECT id, created_at, report_hash, body, anchor_tx, anchor_chain, anchor_result FROM reports WHERE id = ?').bind(id).first();
}

const api = {
  'GET /api/dataset': async (req, env) => json({ dataset: await getDataset(env.DB), chain: chainInfo(env) }),

  'POST /api/extract': async (req, env) => {
    if (!(await allow(env, req, 'extract', 20, 3600))) return fail(429, 'Too many extractions from this connection. Try again in an hour, or enter the claims by hand.');
    const body = await readJson(req);
    const text = String(body.text || '').trim();
    if (text.length < 20) return fail(400, 'Paste at least a sentence of the claim.');
    if (text.length > MAX_TEXT) return fail(400, `Paste at most ${MAX_TEXT.toLocaleString('en-US')} characters.`);
    try {
      return json(await extractClaims(env.AI, text));
    } catch (e) {
      return fail(502, 'The AI step failed. You can still enter the claims by hand.', { detail: String(e.message || e).slice(0, 200) });
    }
  },

  'POST /api/check': async (req, env) => {
    if (!(await allow(env, req, 'check', 60, 3600))) return fail(429, 'Too many checks from this connection. Try again in an hour.');
    const body = await readJson(req);
    const { errors, input } = validateInput(body);
    if (errors.length) return fail(400, errors[0], { errors });
    const report = await runCheck(env.DB, input);
    if (typeof body.source_text === 'string' && body.source_text.trim()) report.source_text = body.source_text.trim().slice(0, MAX_TEXT);
    const hash = await reportHash(report);
    const id = newId();
    await env.DB.prepare('INSERT INTO reports (id, created_at, report_hash, body) VALUES (?, ?, ?, ?)')
      .bind(id, report.created_at, hash, JSON.stringify(report)).run();
    return json({ id, hash, report });
  },

  'GET /api/report': async (req, env, id) => {
    const row = await loadReport(env, id);
    if (!row) return fail(404, 'No report with that ID.');
    const report = JSON.parse(row.body);
    const ledger = await ledgerStatus(env, report, row).catch(() => null);
    const anchor = row.anchor_tx ? { tx: row.anchor_tx, chain: row.anchor_chain, ...(row.anchor_result ? JSON.parse(row.anchor_result) : {}) } : null;
    return json({ id: row.id, hash: row.report_hash, report, anchor, ledger, chain: chainInfo(env) });
  },

  'POST /api/report/anchor': async (req, env, id) => {
    const row = await loadReport(env, id);
    if (!row) return fail(404, 'No report with that ID.');
    if (row.anchor_tx) return json({ tx: row.anchor_tx, chain: row.anchor_chain, ...(row.anchor_result ? JSON.parse(row.anchor_result) : {}), already: true });
    if (!(await allow(env, req, 'anchor', 10, 3600))) return fail(429, 'Too many on-chain records from this connection. Try again in an hour.');
    if (!(await allow(env, { headers: new Headers() }, 'anchor-global', 300, 86400))) return fail(429, 'The daily on-chain budget for this demo is used up. The report itself is saved.');
    const result = await anchorReport(env, JSON.parse(row.body), row.report_hash);
    if (result.error) return fail(result.status || 502, result.error, result);
    await env.DB.prepare('UPDATE reports SET anchor_tx = ?, anchor_chain = ?, anchor_result = ? WHERE id = ?')
      .bind(result.tx, result.chain, JSON.stringify(result), id).run();
    return json(result);
  },

  'GET /api/company': async (req, env) => {
    const u = new URL(req.url);
    const name = (u.searchParams.get('name') || '').slice(0, 120);
    const aliases = u.searchParams.getAll('alias').slice(0, 4);
    const profile = await companyProfile(env.DB, name, aliases);
    if (!profile) return fail(400, 'Enter a company name (3+ letters).');
    return json(profile);
  },

  'GET /api/project': async (req, env, raw) => {
    const id = normalizeProjectId(decodeURIComponent(raw));
    if (!id) return fail(400, 'Not a project ID we recognise.');
    const p = await env.DB.prepare('SELECT * FROM projects WHERE project_id = ?').bind(id).first();
    if (!p) return fail(404, `${id} is not in the registry snapshot.`);
    const vintages = (await env.DB.prepare('SELECT vintage, issued, retired, n_retirements FROM pv_stats WHERE project_id = ? ORDER BY vintage').bind(id).all()).results;
    return json({ project: p, vintages });
  },
};

function route(method, path) {
  const exact = api[`${method} ${path}`];
  if (exact) return [exact, null];
  let m = path.match(/^\/api\/report\/([^/]+)$/);
  if (m && method === 'GET') return [api['GET /api/report'], m[1]];
  m = path.match(/^\/api\/report\/([^/]+)\/anchor$/);
  if (m && method === 'POST') return [api['POST /api/report/anchor'], m[1]];
  m = path.match(/^\/api\/project\/([^/]+)$/);
  if (m && method === 'GET') return [api['GET /api/project'], m[1]];
  return [null, null];
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/r/')) {
      // Report permalinks are a static page that loads the report by ID.
      return env.ASSETS.fetch(new Request(new URL('/report.html', url), req));
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (req.method === 'POST') {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) return fail(403, 'Cross-site requests are not accepted.');
    }
    const [handler, param] = route(req.method, url.pathname);
    if (!handler) return fail(404, 'Unknown API route.');
    try {
      return await handler(req, env, param);
    } catch (e) {
      console.error(e);
      return fail(e.message?.startsWith('Request') ? 400 : 500, e.message?.startsWith('Request') ? e.message : 'Something went wrong on our side. Please try again.');
    }
  },
};
