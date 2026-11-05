"""Load a project's ``.env`` files for the CLI, as the TypeScript CLI does.

The library reads only the real environment: production configuration comes
from the process environment or a secret manager, never from a file the
library opens on its own. The CLI is a local development tool, so like
``flask run``, ``uvicorn --env-file`` and the TypeScript ``hypequery`` CLI, it
loads ``.env.local`` then ``.env`` from the directory it runs in.

A variable that is already set is never replaced, so a real environment
variable beats both files, and ``.env.local`` beats ``.env``. Missing or
unreadable files are skipped.
"""

from __future__ import annotations

import os
import re
from collections.abc import MutableMapping, Sequence
from pathlib import Path

#: Most specific first: earlier files win because nothing already set is replaced.
ENV_FILES = (".env.local", ".env")

_ASSIGNMENT = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
_ESCAPES = {"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}


def load_env_files(directory: Path, environ: MutableMapping[str, str] | None = None) -> list[Path]:
    """Set each variable the env files in *directory* define and *environ* lacks."""

    target = os.environ if environ is None else environ
    loaded: list[Path] = []
    for name in ENV_FILES:
        path = directory / name
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for key, value in parse_env(text):
            target.setdefault(key, value)
        loaded.append(path)
    return loaded


def parse_env(text: str) -> list[tuple[str, str]]:
    """``KEY=value`` pairs in dotenv syntax; lines that are not assignments are ignored."""

    pairs: list[tuple[str, str]] = []
    for line in text.splitlines():
        match = _ASSIGNMENT.match(line.strip())
        if match is None:
            continue
        pairs.append((match.group(1), _value(match.group(2).strip())))
    return pairs


def _value(raw: str) -> str:
    """The value after ``=``: quoted values end at their closing quote, so a trailing
    ``# comment`` is dropped rather than leaving the quotes in the value."""

    if raw[:1] == "'":
        end = raw.find("'", 1)
        if end != -1:
            return raw[1:end]
    elif raw[:1] == '"':
        match = re.match(r'"((?:[^"\\]|\\.)*)"', raw)
        if match is not None:
            return re.sub(
                r"\\(.)", lambda m: _ESCAPES.get(m.group(1), "\\" + m.group(1)), match.group(1)
            )
    # Unquoted (or an unclosed quote): " #" starts a comment, as in shells and python-dotenv.
    return re.split(r"\s+#", raw, maxsplit=1)[0].strip()


def env_root(argv: Sequence[str]) -> Path:
    """Where `.env` files are read for *argv*, decided before parsing.

    The launch directory, as in the TypeScript CLI, except that `mcp --project`
    reads the project's: an MCP client launches the server from anywhere, and
    the project's settings must win. Read from raw arguments so `.env` (and a
    telemetry opt-out in it) loads before parsing.
    """

    positionals = [arg for arg in argv if not arg.startswith("-")]
    if positionals[:1] == ["mcp"]:
        for index, arg in enumerate(argv):
            project = None
            if arg == "--project" and index + 1 < len(argv):
                project = argv[index + 1]
            elif arg.startswith("--project="):
                project = arg.split("=", 1)[1]
            if project is not None and Path(project).is_dir():
                return Path(project).resolve()
    return Path.cwd()
