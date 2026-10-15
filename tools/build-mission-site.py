#!/usr/bin/env python3
"""Build the standalone static delivery demo from original public sources only."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('output', help='Empty or existing standalone Site checkout')
args = parser.parse_args()
site = Path(args.output).resolve()
if site == ROOT or ROOT in site.parents:
    raise SystemExit('Use a separate Site checkout outside the source repository')
dist = site / 'dist'
dist.mkdir(parents=True, exist_ok=True)
assets = dist / 'assets';assets.mkdir(exist_ok=True)
for name in ['style.css','ui.js']:
    shutil.copy2(ROOT / 'assets' / name, assets / name)
for name in ['app.js','browser-service.js','dashboard.css','extended-views.js']:
    shutil.copy2(ROOT / 'mission-control' / name, dist / name)
spec = importlib.util.spec_from_file_location('mission_build',ROOT / 'mission-control' / 'service.py')
module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
(dist / 'seed.js').write_text('window.MISSION_SEED = '+json.dumps(module.seeded(),separators=(',',':'))+';\n')
html = (ROOT / 'mission-control' / 'index.html').read_text()
html = html.replace('<script src="app.js"></script>', '<script src="seed.js"></script><script src="browser-service.js"></script><script src="app.js"></script>')
html = html.replace('<a href="/">← Portfolio home</a>', '<a href="https://github.com/AaronRaja07/projects">Source & portfolio ↗</a>')
html = html.replace('Zero production connections.', 'Changes stay in your browser.')
html = html.replace('Fixed snapshot · 14 OCT 2026','Synthetic · saved in this browser')
html = html.replace('<title>Mission Control · Delivery Tracker</title>', '<meta name="description" content="Aaron Raja’s independent delivery intelligence sandbox. Original code and entirely synthetic data. Explore capacity, scope, risk, forecasts and review workflows."><title>Mission Control · Aaron Raja</title>')
(dist / 'index.html').write_text(html)
# Keep a clear source record in the Site repository alongside deployable assets.
(site / 'README.md').write_text('# Mission Control\n\nOriginal portfolio demo by Aaron Raja, with generated data only.\n\nSource: https://github.com/AaronRaja07/projects\n\nStatic browser sandbox; edits persist in this browser through localStorage. No cloud database, external production connectors, or private source files.\n\nBuilt from `tools/build-mission-site.py` in the public source repository.\n')
manifest = site / '.openai' / 'hosting.json'
if not manifest.exists():
    raise SystemExit('Persist the registered project ID before building')
data=json.loads(manifest.read_text());data['static']={'directory':'dist'};manifest.write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({'output':str(dist),'files':len(list(dist.rglob('*'))),'synthetic':True}))
