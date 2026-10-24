"""Builds company.html, docs.html and 404.html from report.html's header and footer so the shell stays identical."""
import os
import re
from html import escape

pub = os.path.join(os.path.dirname(__file__), '..', 'public')
src = open(os.path.join(pub, 'report.html'), encoding='utf-8').read()
pre, rest = src.split('<main', 1)
foot_match = re.search(r'</main>([\s\S]*?</footer>)', rest)
if not foot_match:
    raise ValueError('report.html must include a main element and footer')
foot = foot_match.group(1) + '\n'


def page(title, desc, nav_cur, body, script=''):
    p, title_count = re.subn(r'<title>[^<]*</title>', f'<title>{escape(title)}</title>', pre, count=1)
    p, desc_count = re.subn(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{escape(desc, quote=True)}">', p, count=1)
    if not title_count or not desc_count:
        raise ValueError('report.html must include a title and description')
    p = p.replace(' aria-current="page"', '')
    if 'class="skip-link"' not in p:
        p = p.replace('<body>', '<body>\n<a class="skip-link" href="#main">Skip to content</a>', 1)
    else:
        p = re.sub(r'(<a class="skip-link" href="#main">)[^<]*(</a>)', r'\1Skip to content\2', p, count=1)
    if nav_cur:
        p = p.replace(f'<a href="{nav_cur}"', f'<a href="{nav_cur}" aria-current="page"', 1)
    tail = f'<script type="module" src="{script}"></script>\n' if script else ''
    return p + body + foot + tail + '</body>\n</html>\n'


def write(name, text):
    with open(os.path.join(pub, name), 'w', encoding='utf-8') as f:
        f.write(text)


company = open(os.path.join(os.path.dirname(__file__), 'pages', 'company.body.html'), encoding='utf-8').read()
docs = open(os.path.join(os.path.dirname(__file__), 'pages', 'docs.body.html'), encoding='utf-8').read()
nf = open(os.path.join(os.path.dirname(__file__), 'pages', '404.body.html'), encoding='utf-8').read()

write('company.html', page('Company lookup · TrueTonne', 'Look up the carbon-credit retirements that name a company in the public registry snapshot.', '/company.html', company, '/company.js'))
write('docs.html', page('Method, data and limits · TrueTonne', 'How TrueTonne matches carbon-credit claims to registry retirements, the data it uses and what it cannot tell you.', '/docs.html', docs))
write('404.html', page('Page not found · TrueTonne', 'Page not found.', None, nf))
