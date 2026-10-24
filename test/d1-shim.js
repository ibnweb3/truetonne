// Minimal D1 interface over node:sqlite, pointed at the local copy of the snapshot (data/local.sqlite).
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export function openLocal(path = fileURLToPath(new URL('../data/local.sqlite', import.meta.url))) {
  const db = new DatabaseSync(path);
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
  });
  return { prepare: (sql) => wrap(sql), exec: (sql) => db.exec(sql), raw: db };
}
