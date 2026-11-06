"""A user's path written into a generated file, read back as exactly that path.

The same double-quoted form is a valid Python string literal and a valid TOML
basic string. Non-ASCII characters are written as themselves: an escaped
emoji becomes a surrogate pair, which TOML rejects and Python keeps as two
code points. A ``.gitignore`` line has its own syntax, so its pattern
characters are escaped and the entry anchored to the project root.
"""

from __future__ import annotations

import json
from pathlib import PurePosixPath

_GITIGNORE_SPECIAL = frozenset("\\[]*?!#")


def quoted(text: str) -> str:
    """*text* as a double-quoted Python string literal and TOML basic string."""

    return json.dumps(text, ensure_ascii=False)


def gitignore_directory(path: str) -> str:
    """A ``.gitignore`` line matching only the directory at *path*, from the project root."""

    posix = PurePosixPath(path).as_posix()
    escaped = "".join("\\" + char if char in _GITIGNORE_SPECIAL else char for char in posix)
    # Git strips unescaped trailing spaces from a pattern.
    if escaped.endswith(" "):
        escaped = escaped[:-1] + "\\ "
    return f"/{escaped}/"
