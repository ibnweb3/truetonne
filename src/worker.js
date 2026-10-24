import { validateInput, validateCompanyNames, runCheck, companyProfile, getDataset } from './check.js';
import { extractClaims, MAX_TEXT } from './extract.js';
import { reportHash } from './hash.js';
import { normalizeProjectId } from './names.js';
import { anchorReport, chainInfo, ledgerStatus, reconcileAnchor } from './chain.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const fail = (status, error, extra = {}) => json({ error, ...extra }, status);

// Fixed-window limit per client IP, stored in D1. Returns true when the call is allowed.
async function allow(env, req, bucket, max, windowSec) {
  try {
    return await allowUnsafe(env, req, bucket, max, windowSec);
  } catch (e) {
    // A broken limiter must not take the read-only checks down; on-chain writes stay closed.
    console.error('rate limiter failed', e);
    return !bucket.startsWith('anchor');
  }
}

async function allowUnsafe(env, req, bucket, max, windowSec) {
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
  const bad = (message, status = 400) => Object.assign(new Error(message), { status });
  if (Number(req.headers.get('content-length')) > maxBytes) throw bad('Request is too large.', 413);
  const reader = req.body?.getReader();
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw bad('Request is too large.', 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  }
  let body;
  try { body = JSON.parse(text || '{}'); } catch { throw bad('Request body must be JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Request body must be a JSON object.');
  return body;
}

const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
};

async function loadReport(env, id) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) return null;
  return env.DB.prepare('SELECT id, created_at, report_hash, body, anchor_tx, anchor_chain, anchor_result FROM reports WHERE id = ?').bind(id).first();
}

async function saveAnchor(env, id, anchor) {
  await env.DB.prepare('UPDATE reports SET anchor_tx = ?, anchor_chain = ?, anchor_result = ? WHERE id = ?')
    .bind(anchor.tx || null, anchor.chain || null, JSON.stringify(anchor), id).run();
}

async function savedAnchor(env, row) {
  const stored = row.anchor_result ? JSON.parse(row.anchor_result) : null;
  if (!row.anchor_tx && !stored) return null;
  // Receipts saved by the earlier release are already confirmed.
  const previous = { status: 'confirmed', tx: row.anchor_tx || undefined, chain: row.anchor_chain || undefined, ...stored };
  if (previous.status === 'pending' && !previous.tx && previous.stage === 'submitting'
      && Date.now() - Date.parse(previous.submitted_at || '') > 120_000) {
    return { ...previous, stage: 'unknown', message: 'Submission was interrupted before a transaction link could be saved. We cannot confirm whether it was sent. Check the ledger status; you can review the inputs to create a new report if you need to start again.' };
  }
  const current = await reconcileAnchor(env, previous);
  if (current.status !== previous.status) {
    // A read should still show the receipt if the database cannot store its new status.
    try { await saveAnchor(env, row.id, current); } catch { current.storage_warning = true; }
  }
  return current;
}

const api = {
  'GET /api/dataset': async (req, env) => {
    const dataset = await getDataset(env.DB);
    if (!dataset) return fail(503, 'Registry data is not available right now. Please try again later.');
    return json({ dataset, chain: chainInfo(env) });
  },

  'POST /api/extract': async (req, env) => {
    if (!(await allow(env, req, 'extract', 20, 3600))) return fail(429, 'Too many extractions from this connection. Try again in an hour, or enter the claims by hand.');
    const body = await readJson(req);
    if (typeof body.text !== 'string') return fail(400, 'Paste the claim as text.');
    const text = body.text.trim();
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
    if (body.source_text !== undefined && typeof body.source_text !== 'string') errors.push('The source statement must be text.');
    else if (body.source_text?.trim().length > MAX_TEXT) errors.push(`Use at most ${MAX_TEXT.toLocaleString('en-US')} characters in the source statement.`);
    if (errors.length) return fail(400, errors[0], { errors });
    const report = await runCheck(env.DB, input);
    if (typeof body.source_text === 'string' && body.source_text.trim()) report.source_text = body.source_text.trim();
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
    const [ledger, anchor] = await Promise.all([
      ledgerStatus(env, report, row).catch(() => null),
      savedAnchor(env, row),
    ]);
    return json({ id: row.id, hash: row.report_hash, report, anchor, ledger, chain: chainInfo(env) });
  },

  'POST /api/report/anchor': async (req, env, id) => {
    const row = await loadReport(env, id);
    if (!row) return fail(404, 'No report with that ID.');
    const previous = await savedAnchor(env, row);
    if (previous) return json({ ...previous, already: true }, previous.status === 'pending' ? 202 : 200);
    if (!(await allow(env, req, 'anchor', 10, 3600))) return fail(429, 'Too many on-chain records from this connection. Try again in an hour.');
    if (!(await allow(env, { headers: new Headers() }, 'anchor-global', 300, 86400))) return fail(429, 'The daily on-chain budget for this demo is used up. The report itself is saved.');
    const report = JSON.parse(row.body);
    // Reserve this report atomically before sending. Two tabs must not submit it twice.
    const submitting = { status: 'pending', stage: 'submitting', submitted_at: new Date().toISOString(),
      message: 'This report is being submitted. Check its status again before taking any further action.' };
    const locked = await env.DB.prepare('UPDATE reports SET anchor_result = ? WHERE id = ? AND anchor_tx IS NULL AND anchor_result IS ?')
      .bind(JSON.stringify(submitting), id, row.anchor_result || null).run();
    if (!locked.meta?.changes) {
      const latest = await loadReport(env, id);
      const anchor = await savedAnchor(env, latest);
      return json({ ...(anchor || submitting), already: true }, anchor?.status === 'confirmed' || anchor?.status === 'failed' ? 200 : 202);
    }
    const result = await anchorReport(env, report, row.report_hash, { onSubmitted: (anchor) => saveAnchor(env, id, anchor) });
    if (result.error) {
      // Simulation/signing failed before a transaction was submitted, so a retry is safe.
      await env.DB.prepare('UPDATE reports SET anchor_result = NULL WHERE id = ? AND anchor_tx IS NULL AND anchor_result = ?')
        .bind(id, JSON.stringify(submitting)).run();
      return fail(result.status || 502, result.error, result);
    }
    try { await saveAnchor(env, id, result); } catch { result.storage_warning = true; }
    return json(result, result.status === 'pending' ? 202 : 200);
  },

  'GET /api/company': async (req, env) => {
    const u = new URL(req.url);
    const { errors, claimant, aliases } = validateCompanyNames(u.searchParams.get('name'), u.searchParams.getAll('alias'));
    if (errors.length) return fail(400, errors[0], { errors });
    const profile = await companyProfile(env.DB, claimant, aliases);
    return json(profile);
  },

  'GET /api/project': async (req, env, raw) => {
    let decoded;
    try { decoded = decodeURIComponent(raw); } catch { return fail(400, 'Not a project ID we recognise.'); }
    const id = normalizeProjectId(decoded);
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
      return env.ASSETS.fetch(new Request(new URL('/report', url), req));
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
      if (!e.status || e.status >= 500) console.error(JSON.stringify({ event: 'api_error', route: url.pathname, message: e.message }));
      if (/row write limit/i.test(e.message || '')) return fail(503, 'This demo has used its free daily database quota, so new reports cannot be saved until midnight UTC. Existing reports still load.');
      return fail(e.status || 500, e.status ? e.message : 'Something went wrong on our side. Please try again.');
    }
  },
};
