"""Turn the CarbonPlan OffsetsDB snapshot (data-raw/) into D1 SQL files (data/).

Run: python -I scripts/build-db.py
Then load with scripts/load-db.sh. Output is deterministic for a given snapshot.
"""
import csv, hashlib, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data-raw')
OUT = os.path.join(ROOT, 'data')
BATCH = 400  # rows per INSERT statement
MAX_STMT = 80_000  # bytes per INSERT statement

csv.field_size_limit(10_000_000)


def q(v):
    if v is None or v == '':
        return 'NULL'
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def write_inserts(f, table, cols, rows):
    # D1 rejects statements over ~100 KB, so batch by size as well as by count.
    head = f"INSERT INTO {table} ({','.join(cols)}) VALUES\n"
    chunk, size = [], 0
    for r in rows:
        t = '(' + ','.join(q(v) for v in r) + ')'
        if chunk and (len(chunk) >= BATCH or size + len(t.encode('utf-8')) > MAX_STMT):
            f.write(head + ',\n'.join(chunk) + ';\n')
            chunk, size = [], 0
        chunk.append(t)
        size += len(t.encode('utf-8')) + 2
    if chunk:
        f.write(head + ',\n'.join(chunk) + ';\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = json.load(open(os.path.join(RAW, 'metadata.json')))
    zip_sha = hashlib.sha256(open(os.path.join(RAW, 'offsets-db.csv.zip'), 'rb').read()).hexdigest()

    projects = []
    for p in csv.DictReader(open(os.path.join(RAW, 'projects.csv'), encoding='utf-8')):
        projects.append((p['project_id'], p['name'], p['registry'], p['country'], p['category'],
                         p['project_type'], p['status'], p['proponent'], p['project_url'],
                         num(p['issued']), num(p['retired'])))

    issued, retired, n_ret = {}, {}, {}
    rets = []
    rid = 0
    for c in csv.DictReader(open(os.path.join(RAW, 'credits.csv'), encoding='utf-8')):
        rid += 1  # row number in credits.csv, stable for this snapshot
        vintage = int(c['vintage']) if c['vintage'].isdigit() else None
        key = (c['project_id'], vintage)
        qty = num(c['quantity'])
        if c['transaction_type'] == 'issuance':
            issued[key] = issued.get(key, 0) + qty
            continue
        if c['transaction_type'] != 'retirement':
            continue
        retired[key] = retired.get(key, 0) + qty
        n_ret[key] = n_ret.get(key, 0) + 1
        third_party = 'third party' in (c['retirement_reason'] or '').lower()
        # Display name: never the free-text note (it can hold private individuals' names).
        shown = (c['retirement_beneficiary_harmonized'] or c['retirement_beneficiary']
                 or ('' if third_party else c['retirement_account']))
        who = ' | '.join(x for x in (c['retirement_beneficiary_harmonized'], c['retirement_beneficiary'],
                                     c['retirement_account'], c['retirement_note']) if x)
        rets.append((rid, c['project_id'], vintage, qty, shown or None, c['retirement_account'] or None,
                     c['retirement_note'][:600] or None, c['retirement_reason'] or None,
                     c['transaction_date'][:10] or None, who[:900] or None))

    pv = [(k[0], k[1], issued.get(k, 0), retired.get(k, 0), n_ret.get(k, 0))
          for k in sorted(set(issued) | set(retired), key=lambda k: (k[0], k[1] or 0))]

    with open(os.path.join(OUT, '01-schema.sql'), 'w', encoding='utf-8') as f:
        f.write(open(os.path.join(ROOT, 'src', 'schema.sql'), encoding='utf-8').read())
        f.write(f"INSERT INTO dataset (id, source, generated_at, zip_sha256, projects, retirements) VALUES "
                f"(1, 'CarbonPlan OffsetsDB', {q(meta['generated_at'])}, {q(zip_sha)}, {len(projects)}, {len(rets)});\n")
    with open(os.path.join(OUT, '02-projects.sql'), 'w', encoding='utf-8') as f:
        write_inserts(f, 'projects', ['project_id', 'name', 'registry', 'country', 'category', 'project_type',
                                      'status', 'proponent', 'url', 'issued', 'retired'], projects)
        write_inserts(f, 'pv_stats', ['project_id', 'vintage', 'issued', 'retired', 'n_retirements'], pv)
    # Retirements split so each file stays a manageable upload.
    per = 125_000
    for part, i in enumerate(range(0, len(rets), per)):
        with open(os.path.join(OUT, f'03-retirements-{part}.sql'), 'w', encoding='utf-8') as f:
            write_inserts(f, 'retirements', ['id', 'project_id', 'vintage', 'quantity', 'shown_as', 'account',
                                             'note', 'reason', 'retired_on', 'who'], rets[i:i + per])
            # FTS rows go in with the data: one big INSERT ... SELECT can exceed D1's per-query time limit.
            write_inserts(f, 'retirements_fts', ['rowid', 'who'], [(r[0], r[9]) for r in rets[i:i + per] if r[9]])
    with open(os.path.join(OUT, '04-fts.sql'), 'w', encoding='utf-8') as f:
        f.write("INSERT INTO projects_fts(rowid, name, project_id) SELECT rowid, name, project_id FROM projects;\n")

    print(json.dumps({'projects': len(projects), 'retirements': len(rets), 'project_vintages': len(pv),
                      'generated_at': meta['generated_at'], 'zip_sha256': zip_sha}))


if __name__ == '__main__':
    sys.exit(main())
