"""The project settings init records in the scaffold's ``pyproject.toml``.

Every scaffold writes ``pyproject.toml``, including the offline example, so
it is where init records a choice regeneration must repeat even when no
schema was discovered: the embedded chDB database the app opens.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

from ..errors import CliError


def recorded_chdb_path(directory: Path) -> str | None:
    """``[tool.hypequery] chdb-path`` from *directory*/pyproject.toml, relative to it."""

    try:
        document = tomllib.loads((directory / "pyproject.toml").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError):
        return None
    tool = document.get("tool", {})
    settings = tool.get("hypequery", {}) if isinstance(tool, dict) else {}
    if not isinstance(settings, dict) or "chdb-path" not in settings:
        return None
    path = settings["chdb-path"]
    if not isinstance(path, str) or not path:
        raise CliError(
            "pyproject.toml records an unusable [tool.hypequery] chdb-path; fix it, or pass "
            "--database and --chdb-path."
        )
    return path
