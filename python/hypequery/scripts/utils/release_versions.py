"""Version rules for Python tags and temporary canary builds."""

from __future__ import annotations

import re

_RELEASE = re.compile(
    r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:(?:a|b|rc)(?:0|[1-9]\d*))?"
)


def tagged_version(project_version: str, tag: str) -> str:
    """Require a canonical alpha/beta/RC/stable tag matching committed metadata."""
    prefix = "python-v"
    version = tag.removeprefix(prefix)
    if not tag.startswith(prefix) or _RELEASE.fullmatch(version) is None:
        raise ValueError("expected python-vX.Y.Z, optionally followed by aN, bN, or rcN")
    if project_version != version:
        raise ValueError(f"tag version {version!r} does not match pyproject {project_version!r}")
    return version


def canary_version(project_version: str, run_number: int, attempt: int) -> str:
    """Make retries unique while preserving the repository's target release."""
    base = re.sub(r"\.dev\d+$", "", project_version)
    if _RELEASE.fullmatch(base) is None:
        raise ValueError("canary base must be X.Y.Z, optionally followed by aN, bN, or rcN")
    if run_number < 1 or not 1 <= attempt < 1000:
        raise ValueError("run number must be positive and attempt must be between 1 and 999")
    return f"{base}.dev{run_number * 1000 + attempt}"


def replace_project_version(source: str, version: str) -> str:
    """Change only the version field in the TOML project section."""
    pattern = re.compile(r'(\[project\]\s*\n(?:(?!\[).)*?^version\s*=\s*)"[^"]+"', re.M | re.S)
    result, count = pattern.subn(lambda match: f'{match[1]}"{version}"', source)
    if count != 1:
        raise ValueError("expected exactly one version in [project]")
    return result
