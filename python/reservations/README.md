# PyPI name reservations

These metadata-only releases reserve official Hypequery project names while the Python SDK is under development. They contain no importable modules.

| PyPI name | Intended destination |
| --- | --- |
| `hypequery` | The future Python SDK |
| `hypequery-datasets` | `hypequery.datasets` in the main SDK |
| `hypequery-serve` | `hypequery.serve` in the main SDK |
| `hypequery-clickhouse` | The main SDK’s `clickhouse` extra |
| `hypequery-fastapi` | The main SDK’s `fastapi` extra |

The placeholders prevent dependency confusion and point users to the correct package shape without pretending working code exists.

## Bootstrap publishing

Build and inspect all reservations before the one-time initial upload:

```bash
cd python/reservations
for package in hypequery hypequery-datasets hypequery-serve hypequery-clickhouse hypequery-fastapi; do
  python -m build --outdir "dist/$package" "$package"
  twine check "dist/$package"/*
done
```

Future real releases use PyPI Trusted Publishing. Each reservation has a local `.gitignore` so Hatchling does not walk up and include monorepo files in its source distribution.
