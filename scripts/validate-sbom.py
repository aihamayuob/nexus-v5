# Validates a CycloneDX JSON BOM against the official schemas. Usage: validate-sbom.py BOM.json SCHEMA_DIR  (SCHEMA_DIR = node_modules/@cyclonedx/cyclonedx-library/res/schema, e.g. from `npm pack @cyclonedx/cyclonedx-library`). Needs python3 jsonschema>=4.18 + referencing.
import json, sys, glob, os
from jsonschema import Draft7Validator
from referencing import Registry, Resource
base = sys.argv[2]; bom = json.load(open(sys.argv[1]))
schema = json.load(open(os.path.join(base, 'bom-%s.SNAPSHOT.schema.json' % bom['specVersion'])))
res = []
for f in glob.glob(os.path.join(base, '*.schema.json')):
    d = json.load(open(f)); 
    if '$id' in d: res.append((d['$id'], Resource.from_contents(d, default_specification=None) if False else Resource.from_contents(d)))
    res.append((os.path.basename(f).replace('.SNAPSHOT', ''), Resource.from_contents(d)))
    res.append((os.path.basename(f), Resource.from_contents(d)))
    res.append(('http://cyclonedx.org/schema/' + os.path.basename(f), Resource.from_contents(d)))
reg = Registry().with_resources(res)
errs = sorted(Draft7Validator(schema, registry=reg).iter_errors(bom), key=lambda e: list(e.path))
print('specVersion', bom['specVersion'], 'components', len(bom['components']), 'schema errors:', len(errs))
for e in errs[:10]: print(' -', list(e.path)[:4], e.message[:160])
sys.exit(1 if errs else 0)
