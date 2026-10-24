"""One-off: adds ids to docs h2s, a sticky contents nav and a two-column wrapper to scripts/pages/docs.body.html."""
import re, os
p = os.path.join(os.path.dirname(__file__), 'pages', 'docs.body.html')
s = open(p, encoding='utf-8').read()
if 'docs-layout' in s:
    raise SystemExit('already done')
slug = lambda t: re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')
items = []


def fix(m):
    attrs, text = m.group(1), m.group(2)
    idm = re.search(r'id="([^"]+)"', attrs)
    i = idm.group(1) if idm else slug(text)
    items.append((i, text))
    return f'<h2 id="{i}">{text}</h2>'


s = re.sub(r'<h2([^>]*)>(.*?)</h2>', fix, s)
toc = '<nav class="toc" aria-label="On this page"><b>On this page</b>' + ''.join(f'<a href="#{i}">{t}</a>' for i, t in items) + '</nav>'
s = s.replace('<main class="wrap narrow prose" id="main">', '<main class="wrap" id="main">\n  <div class="docs-layout">\n  ' + toc + '\n  <div class="prose">', 1)
s = s.replace('</main>', '  </div>\n  </div>\n</main>', 1)
open(p, 'w', encoding='utf-8').write(s)
print(len(items), 'headings')
