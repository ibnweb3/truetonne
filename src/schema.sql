DROP TABLE IF EXISTS dataset;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS pv_stats;
DROP TABLE IF EXISTS retirements;
DROP TABLE IF EXISTS retirements_fts;
DROP TABLE IF EXISTS projects_fts;

CREATE TABLE dataset (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  zip_sha256 TEXT NOT NULL,
  projects INTEGER NOT NULL,
  retirements INTEGER NOT NULL
);

CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  name TEXT,
  registry TEXT,
  country TEXT,
  category TEXT,
  project_type TEXT,
  status TEXT,
  proponent TEXT,
  url TEXT,
  issued REAL,
  retired REAL
);

-- Issued vs retired per project + vintage, from the transaction rows.
CREATE TABLE pv_stats (
  project_id TEXT NOT NULL,
  vintage INTEGER,
  issued REAL NOT NULL,
  retired REAL NOT NULL,
  n_retirements INTEGER NOT NULL
);
CREATE INDEX pv_stats_pv ON pv_stats(project_id, vintage);

-- One row per retirement transaction. id = row number in the snapshot's credits.csv.
-- note/who are used for matching; the UI only shows a note when the claimant's name matched it.
CREATE TABLE retirements (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  vintage INTEGER,
  quantity REAL NOT NULL,
  shown_as TEXT,
  account TEXT,
  note TEXT,
  reason TEXT,
  retired_on TEXT,
  who TEXT
);
CREATE INDEX retirements_pv ON retirements(project_id, vintage);

CREATE VIRTUAL TABLE retirements_fts USING fts5(who, content='', tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE projects_fts USING fts5(name, project_id, content='', tokenize='unicode61 remove_diacritics 2');

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  report_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  anchor_tx TEXT,
  anchor_chain INTEGER,
  anchor_result TEXT
);
CREATE TABLE IF NOT EXISTS rate (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
