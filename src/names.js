// Project IDs and company names: turning what people type into what the snapshot stores.

const REGISTRY_PREFIX = [
  [/^(?:vcs|verra|vcu|vm)$/, 'VCS'],
  [/^(?:gs|gld|gold ?standard)$/, 'GLD'],
  [/^(?:car|climate action reserve)$/, 'CAR'],
  [/^(?:acr|american carbon registry)$/, 'ACR'],
  [/^(?:art|art ?trees|trees)$/, 'ART'],
  [/^(?:ccb)$/, 'CCB'],
];

// "VCS 1477", "VCS-1477", "Verra #1477", "GS1247", "Gold Standard 1247" -> "VCS1477" / "GLD1247".
export function normalizeProjectId(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/[‐-―]/g, '-');
  const m = s.match(/^(vcs|verra|vcu|vm|gs|gld|gold ?standard|car|climate action reserve|acr|american carbon registry|art ?trees|art|trees|ccb)\s*(?:project\s*)?(?:id\s*)?[-#:\s]*\s*(\d{1,6})$/);
  if (m) {
    const pre = REGISTRY_PREFIX.find(([re]) => re.test(m[1]));
    if (pre) return pre[1] + String(Number(m[2]));
  }
  // Isometric and other already-canonical IDs: keep letters+digits, uppercased.
  if (/^[a-z]{2,8}\d[a-z0-9]{0,8}$/.test(s)) return s.toUpperCase();
  return null;
}

// Find every project-ID-looking token in free text (used to check the AI did not invent IDs).
export function projectIdsIn(text) {
  const out = new Set();
  const re = /\b(VCS|Verra|VCU|GS|GLD|Gold Standard|CAR|ACR|ART|CCB)\s*(?:project\s*)?(?:ID\s*)?[-#:\s]?\s*(\d{1,6})\b/gi;
  for (const m of String(text).matchAll(re)) {
    const id = normalizeProjectId(`${m[1]} ${m[2]}`);
    if (id) out.add(id);
  }
  return out;
}

const SUFFIXES = new Set(['inc', 'incorporated', 'ltd', 'limited', 'llc', 'plc', 'ag', 'gmbh', 'sa', 'nv', 'bv',
  'corp', 'corporation', 'co', 'company', 'lp', 'llp', 'srl', 'spa', 'ab', 'as', 'oy', 'kk', 'pty', 'pte', 'the']);

// Lowercase, strip accents and punctuation, drop legal suffixes. "Delta Air Lines, Inc." -> "delta air lines".
export function normalizeName(raw) {
  const words = String(raw || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop();
  while (words.length > 1 && words[0] === 'the') words.shift();
  return words.join(' ');
}

// FTS5 phrase query for a normalized name; null when nothing searchable is left.
export function ftsPhrase(name) {
  const n = normalizeName(name);
  if (n.length < 3) return null;
  return `"${n}"`;
}

// Names to search: the claimant plus up to 4 aliases, de-duplicated after normalizing.
export function nameVariants(claimant, aliases = []) {
  const seen = new Set();
  const out = [];
  for (const raw of [claimant, ...aliases].slice(0, 5)) {
    const n = normalizeName(raw);
    if (n.length >= 3 && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}
