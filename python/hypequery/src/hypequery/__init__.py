"""Hypequery — a ClickHouse semantic layer and serving runtime for Python.

Importing this package must stay cheap and side-effect free: no network calls,
no credential reads, no subprocesses, and no optional dependencies pulled in.
Submodules are deliberately *not* imported here — importing ``hypequery.serve``
eagerly would drag FastAPI into definition-only installs.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _distribution_version

# Read the installed distribution's metadata (a local file read), so tagged,
# canary and release-PR builds report the version they were built with rather
# than a constant that the release tooling never rewrites.
try:
    __version__ = _distribution_version("hypequery")
except PackageNotFoundError:  # pragma: no cover - running from an uninstalled tree
    __version__ = "0+unknown"

__all__ = ["__version__"]
