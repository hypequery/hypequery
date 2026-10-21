"""What to type next after a command creates something."""

from __future__ import annotations

import shlex
from pathlib import Path


def cd_prefix(destination: Path) -> str:
    """``cd <dir> && `` to reach *destination*, relative when it is below here."""

    here = Path.cwd().resolve()
    target = destination.resolve()
    if target == here:
        return ""
    try:
        shown = str(target.relative_to(here))
    except ValueError:
        shown = str(target)
    if shown.startswith("-"):
        # cd would read -analytics as an option, and quoting does not stop it.
        shown = f"./{shown}"
    return f"cd {shlex.quote(shown)} && "
