#!/usr/bin/env python3
"""NEXUS SBOM generator (2026-11-16). CycloneDX 1.6 JSON from: backend + frontend package-lock.json (declared closure),
frontend/vendor/ pinned browser libraries (VENDOR-SHA256.txt), and the images embedded in the HTML (decoded from the page itself).
Usage: gen-sbom.py OUT.json   (run from anywhere; paths are relative to the repo root = parent of scripts/)
Licences = lockfile / upstream declaration only (not independently verified, not a legal review). The root licence is deliberately NOT declared."""
import json, sys, re, base64, hashlib, uuid, datetime, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
def rd(p): return open(os.path.join(ROOT, p), encoding='utf-8').read()
comps = []; summ = []
def purl(name, ver): return 'pkg:npm/' + (name.replace('@', '%40', 1) if name.startswith('@') else name) + '@' + ver
for label, lock in (('frontend', 'frontend/package-lock.json'), ('backend', 'src-baseline/nexus-backend/package-lock.json')):
    d = json.loads(rd(lock)); pk = d.get('packages', {}); root = pk.get('', {})
    direct = set(list(root.get('dependencies', {})) + list(root.get('devDependencies', {})))
    seen = {}; lic = {}
    for path, p in pk.items():
        if not path: continue
        name = p.get('name') or path.split('node_modules/')[-1]; ver = p.get('version')
        key = (name, ver)
        if key in seen: continue
        seen[key] = 1
        l = p.get('license')
        c = {'type': 'library', 'bom-ref': f'{label}:{name}@{ver}', 'name': name, 'version': ver, 'purl': purl(name, ver),
             'scope': 'optional' if p.get('optional') else ('excluded' if p.get('dev') else 'required'),
             'properties': [{'name': 'nexus:workspace', 'value': label}, {'name': 'nexus:dev', 'value': str(bool(p.get('dev'))).lower()}, {'name': 'nexus:direct', 'value': str(name in direct).lower()}]}
        if isinstance(l, str): c['licenses'] = [{'license': {'name': l}}]
        elif l: c['licenses'] = [{'license': {'name': json.dumps(l)}}]
        integ = p.get('integrity', '')
        if integ.startswith('sha512-'): c['hashes'] = [{'alg': 'SHA-512', 'content': base64.b64decode(integ[7:]).hex()}]
        comps.append(c); lic[str(l)] = lic.get(str(l), 0) + 1
    summ.append({'workspace': label, 'unique_components': len(seen), 'licenses': lic})
# vendored browser libs (runtime, shipped to the browser)
VEND = {'qrcode.min.js': ('qrcodejs', '1.0.0', 'MIT', 'pkg:npm/qrcodejs@1.0.0'), 'jsQR.js': ('jsQR', '1.4.0', 'Apache-2.0', 'pkg:npm/jsqr@1.4.0'),
        'pdf.min.mjs': ('pdf.js', '4.10.38', 'Apache-2.0', 'pkg:npm/pdfjs-dist@4.10.38'), 'pdf.worker.min.mjs': ('pdf.js (worker)', '4.10.38', 'Apache-2.0', 'pkg:npm/pdfjs-dist@4.10.38')}
for line in rd('frontend/vendor/VENDOR-SHA256.txt').splitlines():
    m = re.match(r'^([0-9a-f]{64})  (\S+)$', line)
    if not m: continue
    n, v, l, pu = VEND[m.group(2)]
    comps.append({'type': 'library', 'bom-ref': f'vendor:{m.group(2)}', 'name': n, 'version': v, 'scope': 'required', 'purl': pu,
                  'description': f'frontend/vendor/{m.group(2)} (same-origin, pinned; F-05)', 'licenses': [{'license': {'id': l}}],
                  'hashes': [{'alg': 'SHA-256', 'content': m.group(1)}],
                  'properties': [{'name': 'nexus:workspace', 'value': 'browser-runtime'}, {'name': 'nexus:licence-verification', 'value': 'upstream declaration only (UNVERIFIED independently)'}]})
# embedded images, decoded from the page itself
html = rd('frontend/neural_nexus_ai_agents-4-3-5-3.html')
imgs = []
m = re.search(r'data:image/svg\+xml;base64,([A-Za-z0-9+/=]+)', html); imgs.append(('favicon.svg (embedded)', 'image/svg+xml', base64.b64decode(m.group(1))))
m = re.search(r'data:image/png;base64,([A-Za-z0-9+/=]+)', html); imgs.append(('icon-192x192.png (embedded, apple-touch-icon; also reused in manifest)', 'image/png', base64.b64decode(m.group(1))))
m = re.search(r'data:application/manifest\+json;base64,([A-Za-z0-9+/=]+)', html); man = json.loads(base64.b64decode(m.group(1)))
for ic in man.get('icons', []):
    mm = re.match(r'data:image/png;base64,(.+)', ic.get('src', ''))
    if mm and ic.get('sizes') == '512x512': imgs.append(('icon-512x512.png (embedded in manifest)', 'image/png', base64.b64decode(mm.group(1))))
for n, mt, b in imgs:
    comps.append({'type': 'file', 'bom-ref': 'image:' + n.split(' ')[0], 'name': n, 'mime-type': mt, 'scope': 'required',
                  'hashes': [{'alg': 'SHA-256', 'content': hashlib.sha256(b).hexdigest()}],
                  'properties': [{'name': 'nexus:bytes', 'value': str(len(b))}, {'name': 'nexus:authorship-licence', 'value': 'UNVERIFIED (owner attestation pending, D-7)'}]})
bom = {'bomFormat': 'CycloneDX', 'specVersion': '1.6', 'serialNumber': 'urn:uuid:' + str(uuid.uuid4()), 'version': 1,
       'metadata': {'timestamp': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                    'component': {'type': 'application', 'bom-ref': 'nexus-root', 'name': 'NEXUS (Neural Nexus AI Agents)', 'version': '5.0.0-modularize'},
                    'properties': [{'name': 'nexus:note', 'value': 'Lockfile closure + pinned browser libs + embedded images. Licences are declared values only; root licence deliberately undeclared; not a legal review.'}]},
       'components': comps}
json.dump(bom, open(sys.argv[1], 'w'), indent=1, ensure_ascii=False)
print(json.dumps({'total_components': len(comps), 'per_workspace': summ, 'images': len(imgs)}, indent=1, ensure_ascii=False))
