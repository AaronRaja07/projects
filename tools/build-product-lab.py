#!/usr/bin/env python3
"""Package the public portfolio and its two standalone browser demonstrations."""
import argparse
import json
from pathlib import Path
import shutil

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('output',help='Separate registered Site source checkout')
args=parser.parse_args()
site=Path(args.output).resolve()
if site==ROOT or ROOT in site.parents:
    raise SystemExit('Use a separate Site checkout outside the public source repository')
manifest=site/'.openai'/'hosting.json'
if not manifest.exists():raise SystemExit('Persist the registered project ID first')
dist=site/'dist';dist.mkdir(parents=True,exist_ok=True)
assets=dist/'assets';assets.mkdir(exist_ok=True)
for name in ['style.css','ui.js']:shutil.copy2(ROOT/'assets'/name,assets/name)
mission='https://aaron-raja-mission-control.cheekyllama6.chatgpt.site'
html=(ROOT/'index.html').read_text().replace('href="mission-control/"',f'href="{mission}"').replace('href="README.md"','href="https://github.com/AaronRaja07/projects#readme"')
(dist/'index.html').write_text(html)
for slug in ['signal-lab','pipeline-rescue']:
    source=ROOT/slug;destination=dist/slug;destination.mkdir(exist_ok=True)
    files=['app.js','browser-service.js']
    scripts=''
    if slug=='pipeline-rescue':files.append('seed.js');scripts+='<script src="seed.js"></script>'
    scripts+='<script src="browser-service.js"></script>'
    for name in files:shutil.copy2(source/name,destination/name)
    html=(source/'index.html').read_text()
    for name in ['app.js','browser-service.js','seed.js']:
        html=html.replace(f'src="/{slug}/{name}"',f'src="{name}"')
    for name in ['README.md','PRODUCT-BRIEF.md']:
        html=html.replace(f'href="{name}"',f'href="https://github.com/AaronRaja07/projects/blob/main/{slug}/{name}"').replace(f'href="/{slug}/{name}"',f'href="https://github.com/AaronRaja07/projects/blob/main/{slug}/{name}"')
    if '<script src="app.js"></script>' not in html:raise SystemExit('Missing app entrypoint: '+slug)
    if '<script src="browser-service.js"></script>' not in html:
        html=html.replace('<script src="app.js"></script>',scripts+'<script src="app.js"></script>')
    (destination/'index.html').write_text(html)
    for name in ['README.md','PRODUCT-BRIEF.md']:
        if (source/name).exists():shutil.copy2(source/name,destination/name)
config=json.loads(manifest.read_text());config['static']={'directory':'dist'};manifest.write_text(json.dumps(config,indent=2)+'\n')
(site/'README.md').write_text('# Aaron Raja · Product & Engineering Lab\n\nIndependent synthetic-data portfolio. Hosted experiments execute in-browser; Relay persists locally in each visitor’s browser. The local source implementation retains Python/SQLite for reproducible engineering review.\n\nSource: https://github.com/AaronRaja07/projects\n\nNo private data, original employer source, credentials, live connections, or generated local runtime state are included. Build with tools/build-product-lab.py from the public repository.\n')
print(json.dumps({'output':str(dist),'files':len([p for p in dist.rglob('*') if p.is_file()]),'synthetic':True}))
