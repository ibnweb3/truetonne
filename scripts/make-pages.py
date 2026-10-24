"""Builds company.html, docs.html and 404.html from report.html's header and footer so the shell stays identical."""
import os

pub = os.path.join(os.path.dirname(__file__), '..', 'public')
src = open(os.path.join(pub, 'report.html'), encoding='utf-8').read()
pre, rest = src.split('<main', 1)
foot = rest.split('</main>', 1)[1].split('<script')[0]


def page(title, desc, nav_cur, body, script=''):
    p = pre.replace('<title>Check report · TrueTonne</title>', f'<title>{title}</title>')
    p = p.replace('A TrueTonne check: which claimed carbon-credit tonnes are backed by public registry retirements.', desc)
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
