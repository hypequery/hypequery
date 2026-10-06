"""Verify installed Python CLI artifacts outside the checkout (PYE-01D).

Usage: uv run python scripts/cli_smoke.py dist/hypequery-*.whl [--minimal]

Without --minimal, requires a local ClickHouse service configured with
CLICKHOUSE_HOST/PORT/USERNAME/PASSWORD; creates and drops its own scratch DB.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from utils.installed_cli import verify_artifact


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("artifact", type=Path, help="built wheel or sdist")
    parser.add_argument("--minimal", action="store_true", help="verify base install without extras")
    args = parser.parse_args()
    artifact = args.artifact.resolve()
    if not artifact.is_file():
        parser.error("artifact must be an existing file")
    verify_artifact(artifact, minimal=args.minimal)


if __name__ == "__main__":
    main()
