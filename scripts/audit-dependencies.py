"""Pinned Python dependency advisory lookup; no package installation."""

import json
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen


def main():
    root = Path(__file__).resolve().parents[1]
    lock = tomllib.loads((root / 'uv.lock').read_text(encoding='utf-8'))
    packages = [package for package in lock['package'] if 'registry' in package.get('source', {})]
    queries = [{'package': {'name': package['name'], 'ecosystem': 'PyPI'}, 'version': package['version']} for package in packages]
    request = Request('https://api.osv.dev/v1/querybatch', data=json.dumps({'queries': queries}).encode(), headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=45) as response:
        results = json.load(response)['results']
    report = {'checked_at': datetime.now(UTC).isoformat(), 'source': 'https://api.osv.dev/v1/querybatch',
              'packages': [{**query, 'advisories': result.get('vulns', [])} for query, result in zip(queries, results, strict=True)]}
    directory = root / 'artifacts/e2e/phase7/security-review'
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'python-dependencies.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'packages_checked': len(packages), 'packages_with_advisories': sum(bool(result.get('vulns')) for result in results)}))


if __name__ == '__main__':
    main()
