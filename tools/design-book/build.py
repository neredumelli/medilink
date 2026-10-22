"""Builds docs/design-book.html: real screenshots + functional flow diagrams in one shareable page.
Run: python3 tools/design-book/build.py  (needs Pillow)"""
import base64, io, json, re, html, pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SHOTS = ROOT / 'docs' / 'screenshots'
FLOWS = ROOT / 'docs' / 'functional-flows.md'
OUT = ROOT / 'docs' / 'design-book.html'

GROUPS = [
    ('Shop app (phone)', 'For medical shop owners and staff. Same screens on Android, iPhone and web.', [f'{i:02d}' for i in range(1, 16)] + ['20']),
    ('Distributor console', 'For distributor owners and order-desk staff.', ['16', '17']),
    ('Admin panel', 'For the MediLink team.', ['18', '19', '21']),
    ('Shop app: when something goes wrong', 'Calm, translated screens instead of errors. They check again by themselves and disappear when MediLink is back.', ['22', '23']),
]

def img_data(path: pathlib.Path, width: int) -> str:
    im = Image.open(path).convert('RGB')
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=78, optimize=True, progressive=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()

shots = {s['name'][:2]: s for s in json.loads((SHOTS / 'index.json').read_text())}

screen_html = []
for title, sub, keys in GROUPS:
    phone = title.startswith('Shop')
    cards = []
    for k in keys:
        s = shots.get(k)
        if not s:
            continue
        src = img_data(SHOTS / s['file'], 560 if phone else 1400)
        cap = html.escape(s['title'])
        cards.append(f'''<figure class="shot {'phone' if phone else 'wide'}"><button class="zoom" type="button" data-title="{cap}" aria-label="Open full size: {cap}"><img src="{src}" alt="{cap}" loading="lazy"></button><figcaption><span class="n">{k}</span>{cap}</figcaption></figure>''')
    screen_html.append(f'<section class="group"><div class="group-h"><h3>{html.escape(title)}</h3><p>{html.escape(sub)}</p></div><div class="grid {"phones" if phone else "wides"}">{"".join(cards)}</div></section>')

md = FLOWS.read_text()
flow_html = []
for m in re.finditer(r'^## (F\d+)\. (.+?)\n```mermaid\n(.*?)```', md, re.S | re.M):
    fid, title, body = m.group(1), m.group(2).strip(), m.group(3)
    status = 'built' if '✅' in title else 'planned'
    clean = title.replace('✅', '').replace('⏳', '').strip()
    flow_html.append(f'''<article class="flow" id="{fid.lower()}"><div class="flow-h"><span class="fid">{fid}</span><h3>{html.escape(clean)}</h3><span class="pill {status}">{'Built' if status == 'built' else 'Planned'}</span></div><div class="diagram"><pre class="mermaid">{html.escape(body)}</pre></div></article>''')
toc = ''.join(f'<a href="#{m.group(1).lower()}">{m.group(1)} · {html.escape(m.group(2).replace("✅","").replace("⏳","").strip())}</a>' for m in re.finditer(r'^## (F\d+)\. (.+?)$', md, re.M))

page = (pathlib.Path(__file__).parent / 'template.html').read_text()
page = page.replace('{{SCREENS}}', ''.join(screen_html)).replace('{{FLOWS}}', ''.join(flow_html)).replace('{{TOC}}', toc)
page = page.replace('{{NSHOTS}}', str(len(shots))).replace('{{NFLOWS}}', str(len(flow_html)))
OUT.write_text(page)
print(OUT, round(OUT.stat().st_size / 1e6, 2), 'MB', len(shots), 'shots', len(flow_html), 'flows')
