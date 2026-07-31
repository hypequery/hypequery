"""Audit built distribution artifacts before they can be published.

Runs identically on a developer machine and in CI. Deliberately written in
Python rather than shell: the previous shell version used `tar --wildcards`,
which BSD/macOS tar does not support, so the check silently passed by erroring
out inside an `||` fallback. A false pass in a supply-chain check is worse than
no check.

Usage:  python scripts/audit_artifacts.py dist/
Exits non-zero, with an explanation, if anything is wrong.
"""

from __future__ import annotations

import sys
import tarfile
import zipfile
from collections.abc import Iterable
from pathlib import Path

# Files that must never reach PyPI, matched per path component.
FORBIDDEN_NAMES = frozenset({".env", ".venv", "node_modules", "__pycache__", ".DS_Store", ".git"})

# Everything the package needs in order to be usable and typed.
REQUIRED_WHEEL_ENTRIES = ("hypequery/__init__.py", "hypequery/py.typed")


def _is_forbidden(path: str) -> str | None:
    for part in Path(path).parts:
        if part in FORBIDDEN_NAMES:
            return part
        # Tool caches: .mypy_cache, .ruff_cache, .import_linter_cache, ...
        if part.startswith(".") and part.endswith("_cache"):
            return part
    return None


def _check_forbidden(kind: str, names: Iterable[str]) -> list[str]:
    problems = []
    for name in names:
        offender = _is_forbidden(name)
        if offender is not None:
            problems.append(f"{kind} contains {offender!r} via {name!r}")
    return problems


def audit_wheel(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()

    problems = _check_forbidden("wheel", names)
    for required in REQUIRED_WHEEL_ENTRIES:
        if required not in names:
            problems.append(f"wheel is missing {required!r}")
    return problems


def audit_sdist(path: Path) -> list[str]:
    with tarfile.open(path) as archive:
        names = archive.getnames()
        problems = _check_forbidden("sdist", names)

        # Hatchling always bundles the nearest .gitignore. In a monorepo that
        # can be the repository root's, which leaks unrelated project layout.
        for name in names:
            if Path(name).name != ".gitignore":
                continue
            member = archive.extractfile(name)
            if member is None:
                continue
            content = member.read().decode("utf-8", errors="replace")
            if "node_modules" in content:
                problems.append(
                    f"sdist bundled the monorepo root .gitignore as {name!r}; "
                    "add a package-local .gitignore to shadow it"
                )
    return problems


def main(argv: list[str]) -> int:
    dist = Path(argv[1]) if len(argv) > 1 else Path("dist")
    wheels = sorted(dist.glob("*.whl"))
    sdists = sorted(dist.glob("*.tar.gz"))

    if not wheels or not sdists:
        print(f"error: expected at least one wheel and one sdist in {dist}/", file=sys.stderr)
        return 2

    problems: list[str] = []
    for wheel in wheels:
        problems += audit_wheel(wheel)
    for sdist in sdists:
        problems += audit_sdist(sdist)

    if problems:
        print("Artifact audit FAILED:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    checked = ", ".join(p.name for p in [*wheels, *sdists])
    print(f"Artifact audit passed: {checked}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
