"""Validation and insertion rules for reviewed Python release notes."""

from __future__ import annotations

import re

from packaging.version import Version

from .release_versions import tagged_version

RELEASE_NOTES_MARKER = "<!-- towncrier release notes start -->\n"


def validate_next_version(current: str, target: str, changelog: str) -> None:
    tagged_version(target, f"python-v{target}")
    if Version(target) <= Version(current):
        raise ValueError(f"release version {target} must be newer than {current}")
    if re.search(rf"^## {re.escape(target)}(?:\s|$)", changelog, re.M):
        raise ValueError(f"changelog already contains release {target}")
    if changelog.count(RELEASE_NOTES_MARKER) != 1:
        raise ValueError("changelog must contain exactly one Towncrier insertion marker")


def insert_release_notes(changelog: str, notes: str) -> str:
    if changelog.count(RELEASE_NOTES_MARKER) != 1:
        raise ValueError("changelog must contain exactly one Towncrier insertion marker")
    before, after = changelog.split(RELEASE_NOTES_MARKER)
    return before + RELEASE_NOTES_MARKER + "\n" + notes.strip() + "\n\n" + after.lstrip()
