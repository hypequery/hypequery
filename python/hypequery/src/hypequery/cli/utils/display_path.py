"""Paths as users read them: absolute and without ``..`` segments."""

from __future__ import annotations

import os
from pathlib import Path


def display_path(path: Path) -> str:
    # Lexical normalisation is for display only; file operations keep the real path.
    return os.path.normpath(path.absolute())
