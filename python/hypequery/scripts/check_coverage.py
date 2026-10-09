"""Enforce per-package coverage floors from a ``coverage json`` report.

coverage.py has one global ``fail_under``. The packages carry different risk
and different amounts of out-of-process code (the conformance adapters run
under the TypeScript runner), so each gets its own floor. Raise a floor when a
package's coverage improves; never lower one to make a change pass.

Usage: ``uv run coverage json -o coverage.json`` then
``uv run python scripts/check_coverage.py coverage.json``.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import cast

#: Combined statement + branch coverage floors, in percent.
FLOORS: Mapping[str, float] = {
    "datasets": 95.0,
    "serve": 94.0,
    "cli": 90.0,
    "execution": 84.0,
    "protocol": 84.0,
}

_PACKAGE_ROOT = "src/hypequery/"


def package_of(path: str) -> str | None:
    """The top-level ``hypequery`` subpackage a measured file belongs to."""

    normalized = path.replace("\\", "/")
    _, found, rest = normalized.partition(_PACKAGE_ROOT)
    if not found or "/" not in rest:
        return None
    return rest.split("/", 1)[0]


def package_coverage(report: Mapping[str, object]) -> dict[str, float]:
    """Combined coverage per package, weighting statements and branches alike."""

    totals: dict[str, list[int]] = {}
    files = cast(Mapping[str, Mapping[str, Mapping[str, int]]], report["files"])
    for path, data in files.items():
        package = package_of(path)
        if package is None:
            continue
        summary = data["summary"]
        counts = totals.setdefault(package, [0, 0])
        counts[0] += summary["covered_lines"] + summary.get("covered_branches", 0)
        counts[1] += summary["num_statements"] + summary.get("num_branches", 0)
    return {name: 100 * covered / total for name, (covered, total) in totals.items() if total}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_coverage.py coverage.json", file=sys.stderr)
        return 2
    report = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    measured = package_coverage(report)
    failed = False
    for package, floor in FLOORS.items():
        actual = measured.get(package)
        if actual is None:
            print(f"{package}: not measured (floor {floor:.2f}%)")
            failed = True
            continue
        status = "ok" if actual >= floor else "BELOW FLOOR"
        print(f"{package}: {actual:.2f}% (floor {floor:.2f}%) {status}")
        failed = failed or actual < floor
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
