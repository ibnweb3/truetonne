// AI step: read a pasted sustainability claim and pull out structured offset claims.
// The model only extracts. Every project ID and tonne figure it returns must appear in the pasted text,
// otherwise it is dropped and the user is told, so the check never runs on numbers the model made up.

import { normalizeProjectId, projectIdsIn } from './names.js';

export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const MAX_TEXT = 6000;

const SCHEMA = {
  type: 'object',
  properties: {
    claimant: { type: 'string', description: 'Organisation making the claim, as written in the text. Empty if not stated.' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Registry project ID exactly as written (e.g. "VCS 1477", "GS1247"). Empty if none.' },
          project_name: { type: 'string', description: 'Project name as written. Empty if none.' },
          vintage: { type: 'integer', description: 'Credit vintage year if stated, else 0.' },
          tonnes: { type: 'number', description: 'Tonnes CO2e of credits claimed as retired/offset, as written. 0 if not stated.' },
          year: { type: 'integer', description: 'Year the credits were retired / the offsetting year, if stated, else 0.' },
          quote: { type: 'string', description: 'The exact sentence from the text this claim comes from.' },
        },
        required: ['project_id', 'project_name', 'vintage', 'tonnes', 'year', 'quote'],
      },
    },
  },
  required: ['claimant', 'claims'],
};

const SYSTEM = `You extract carbon-offset claims from text. Return JSON only.
A claim is a statement that an organisation retired, used, bought or applied carbon credits/offsets.
Rules:
- Copy values exactly from the text. Never guess, convert units, or fill in missing values.
- If a value is not stated, use "" for strings and 0 for numbers.
- One claim per distinct project or per distinct stated total. Do not split one sentence into several claims.
- Ignore emissions figures, targets and pledges that are not credits retired.
- At most 12 claims.`;

const MULT = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mn: 1e6, mt: 1e6, mtco2e: 1e6, billion: 1e9 };

// Every number written in the text, including "1.2 million" and "450k" forms.
export function numbersIn(text) {
  const out = new Set();
  const re = /(\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.(\d+))?\s*(thousand|million|billion|mtco2e|mt|mn|k|m)?\b/gi;
  for (const m of String(text).matchAll(re)) {
    const base = Number(m[1].replace(/[,\s]/g, '') + (m[2] ? '.' + m[2] : ''));
    if (!Number.isFinite(base)) continue;
    out.add(base);
    const mult = m[3] && MULT[m[3].toLowerCase()];
    if (mult) out.add(Math.round(base * mult * 1000) / 1000);
  }
  return out;
}

const yearIn = (text, y) => new RegExp(`\\b${y}\\b`).test(text);

export function vetExtraction(text, raw) {
  const ids = projectIdsIn(text);
  const nums = numbersIn(text);
  const dropped = [];
  const claims = [];
  for (const c of (Array.isArray(raw?.claims) ? raw.claims : []).slice(0, 12)) {
    if (!c || typeof c !== 'object') continue;
    const quote = String(c.quote || '').trim();
    const out = { project_id: '', project_name: '', vintage: null, tonnes: null, year: null, quote: '' };
    if (quote && text.includes(quote)) out.quote = quote.slice(0, 400);
    else if (quote) dropped.push('a quoted sentence was not found in your text');
    const id = normalizeProjectId(c.project_id);
    if (id) {
      if (ids.has(id)) out.project_id = id;
      else dropped.push(`project ID "${c.project_id}" is not in the text`);
    }
    const name = String(c.project_name || '').trim();
    if (name) {
      if (text.toLowerCase().includes(name.toLowerCase())) out.project_name = name.slice(0, 160);
      else dropped.push(`project name "${name}" is not in the text`);
    }
    const t = Number(c.tonnes);
    if (t > 0) {
      if (nums.has(t)) out.tonnes = t;
      else dropped.push(`${t.toLocaleString('en-US')} tonnes is not written in the text`);
    }
    for (const k of ['vintage', 'year']) {
      const y = Number(c[k]);
      if (y >= 1990 && y <= 2100) {
        if (yearIn(text, y)) out[k] = y;
        else dropped.push(`${k} ${y} is not in the text`);
      }
    }
    if (out.project_id || out.project_name || out.tonnes) claims.push(out);
  }
  const claimant = String(raw?.claimant || '').trim();
  return {
    claimant: claimant && text.toLowerCase().includes(claimant.toLowerCase()) ? claimant.slice(0, 120) : '',
    claims,
    dropped,
  };
}

export async function extractClaims(ai, text) {
  const res = await ai.run(MODEL, {
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    temperature: 0,
    max_tokens: 1500,
  });
  let raw = res?.response;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (!raw || typeof raw !== 'object') throw new Error('The model did not return readable JSON.');
  return { model: MODEL, ...vetExtraction(text, raw) };
}
