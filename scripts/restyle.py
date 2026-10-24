"""One-off: applies the Gemini redesign tokens and layout to public/style.css, fonts and report.js."""
import glob, os
os.chdir(os.path.join(os.path.dirname(__file__), '..', 'public'))

s = open('style.css', encoding='utf-8').read()
a = s.index(':root {'); b = s.index('* { box-sizing')
tokens = """:root {
  --bg: #f9fafb;
  --surface: #ffffff;
  --ink: #111827;
  --muted: #4b5563;
  --faint: #6b7280;
  --line: #e5e7eb;
  --line-strong: #d1d5db;
  --accent: #047857;
  --accent-ink: #ffffff;
  --accent-soft: #ecfdf5;
  --ok: #047857;
  --ok-soft: #ecfdf5;
  --warn: #b45309;
  --warn-soft: #fffbeb;
  --bad: #b91c1c;
  --bad-soft: #fef2f2;
  --info-soft: #f3f4f6;
  --focus: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
  --radius: 6px;
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0d0d;
    --surface: #141414;
    --ink: #ededed;
    --muted: #a3a3a3;
    --faint: #8a8a8a;
    --line: #262626;
    --line-strong: #3a3a3a;
    --accent: #10b981;
    --accent-ink: #04130c;
    --accent-soft: rgba(16, 185, 129, 0.1);
    --ok: #10b981;
    --ok-soft: rgba(16, 185, 129, 0.1);
    --warn: #f59e0b;
    --warn-soft: rgba(245, 158, 11, 0.1);
    --bad: #f87171;
    --bad-soft: rgba(239, 68, 68, 0.1);
    --info-soft: #1c1c1c;
    color-scheme: dark;
  }
}

"""
s = s[:a] + tokens + s[b:]


def rep(old, new):
    global s
    assert old in s, old
    s = s.replace(old, new, 1)


rep(".top { border-bottom: 1px solid var(--line); background: var(--surface);", ".top { border-bottom: 1px solid var(--line); background: var(--bg);")

a = s.index('/* Tabs */'); b = s.index('/* Forms */')
s = s[:a] + """/* Tabs: segmented control */
.tabs { display: inline-flex; gap: 2px; margin: 12px 22px 0; padding: 3px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); }
@media (max-width: 560px) { .tabs { margin: 12px 16px 0; display: flex; } .tab { flex: 1; } }
.tab { appearance: none; border: 0; background: none; font: inherit; font-size: 0.92rem; font-weight: 500; color: var(--muted); padding: 8px 14px; min-height: 36px; cursor: pointer; border-radius: 4px; user-select: none; }
.tab[aria-selected='true'] { color: var(--ink); background: var(--surface); box-shadow: 0 0 0 1px var(--line-strong); }
.tab:focus-visible { box-shadow: var(--focus); outline: none; }

""" + s[b:]

rep("border: 1px solid var(--line-strong); border-radius: 6px; padding: 10px 12px; outline: none;", "border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 10px 12px; outline: none;")
rep("width: 100%; font: inherit; font-size: 16px; color: var(--ink); background: var(--bg);", "width: 100%; font: inherit; font-size: 16px; color: var(--ink); background: var(--surface);")
rep("input:focus, textarea:focus, select:focus { box-shadow: var(--focus); border-color: var(--accent); }", "input:focus, textarea:focus, select:focus { box-shadow: none; border-color: var(--accent); outline: 1px solid var(--accent); outline-offset: 0; }")
rep("font: inherit; font-weight: 500; font-size: 0.97rem; padding: 10px 16px; min-height: 44px; border-radius: 6px;", "font: inherit; font-weight: 500; font-size: 0.95rem; padding: 8px 16px; min-height: 40px; border-radius: var(--radius);")

a = s.index('.note { border-radius'); b = s.index('.note ul')
s = s[:a] + """.note { border-radius: var(--radius); border-left: 3px solid var(--faint); padding: 12px 14px; font-size: 0.93rem; background: var(--info-soft); }
.note.warn { background: var(--warn-soft); color: var(--warn); border-left-color: var(--warn); }
.note.bad { background: var(--bad-soft); color: var(--bad); border-left-color: var(--bad); }
.note.ok { background: var(--ok-soft); color: var(--ok); border-left-color: var(--ok); }
""" + s[b:]

rep(".verdict { display: inline-flex; align-items: center; gap: 6px; font-size: 0.84rem; font-weight: 500; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }",
    ".verdict { display: inline-flex; align-items: center; gap: 6px; font: 500 0.72rem/1 var(--mono); text-transform: uppercase; letter-spacing: 0.04em; height: 24px; padding: 0 9px; border-radius: 4px; border: 1px solid currentColor; white-space: nowrap; }")
rep(".summary .v { font-size: 1.45rem; font-weight: 600; font-variant-numeric: tabular-nums;", ".summary .v { font: 500 1.4rem/1.3 var(--mono); font-variant-numeric: tabular-nums;")
rep(".figures .v { font-size: 1.2rem; font-weight: 600; font-variant-numeric: tabular-nums; }", ".figures .v { font: 500 1.2rem/1.4 var(--mono); font-variant-numeric: tabular-nums; }")
rep("table.data td { padding: 8px 10px;", "table.data td { padding: 9px 10px;")
rep("table.data td.r, table.data th.r { text-align: right; }", "table.data td.r, table.data th.r { text-align: right; }\ntable.data td.r, table.data td.mono { font-family: var(--mono); font-size: 0.86rem; }")
rep(".table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; }", ".table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); }")
rep(".bar { height: 6px;", ".bar { height: 4px;")
rep(".step .k { font-family: var(--mono); font-size: 0.8rem; color: var(--accent); }", ".step .k { font-family: var(--mono); font-size: 0.78rem; color: var(--accent); text-transform: uppercase; letter-spacing: 0.04em; }")
rep(".stamp { margin-top: 18px; display: inline-flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.86rem;", ".stamp { margin-top: 18px; font-family: var(--mono); display: inline-flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.8rem;")

s += """
/* Report: claims left, verification right (desktop) */
.report-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; align-items: start; margin-top: 16px; }
.report-grid .claim:first-child { margin-top: 0; }
.report-aside { position: sticky; top: 76px; display: grid; gap: 16px; }
.report-aside .section { margin: 0; }
@media (max-width: 960px) { .report-grid { grid-template-columns: minmax(0, 1fr); } .report-aside { position: static; } }

/* Docs: sticky contents */
.docs-layout { display: grid; grid-template-columns: 200px minmax(0, 720px); gap: 48px; align-items: start; }
.toc { position: sticky; top: 84px; padding-top: 48px; font-size: 0.88rem; }
.toc b { display: block; font: 500 0.72rem/1 var(--mono); text-transform: uppercase; letter-spacing: 0.04em; color: var(--faint); margin-bottom: 10px; }
.toc a { display: block; padding: 5px 0 5px 12px; border-left: 1px solid var(--line); color: var(--muted); text-decoration: none; }
@media (hover: hover) { .toc a:hover { color: var(--ink); border-left-color: var(--accent); } }
@media (max-width: 960px) { .docs-layout { grid-template-columns: minmax(0, 1fr); } .toc { display: none; } }
"""
open('style.css', 'w', encoding='utf-8').write(s)

old = 'family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap'
new = 'family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap'
for f in glob.glob('*.html'):
    t = open(f, encoding='utf-8').read()
    if old in t:
        open(f, 'w', encoding='utf-8').write(t.replace(old, new))
    else:
        print('no old fonts in', f)

r = open('report.js', encoding='utf-8').read()
old = """    ...r.claims.map(claimCard),
    ...(r.source_text ? [h('details', { class: 'section card card-pad' }, h('summary', {}, 'Original text supplied for this check'), h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, r.source_text))] : []),
    proofPanel(data),
    chainPanel(data));"""
new = """    h('div', { class: 'report-grid' },
      h('div', { class: 'report-main' },
        ...r.claims.map(claimCard),
        ...(r.source_text ? [h('details', { class: 'section card card-pad' }, h('summary', {}, 'Original text supplied for this check'), h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, r.source_text))] : [])),
      h('aside', { class: 'report-aside', 'aria-label': 'Verification' }, proofPanel(data), chainPanel(data))));"""
assert old in r
open('report.js', 'w', encoding='utf-8').write(r.replace(old, new))
print('ok')
