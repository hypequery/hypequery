"""Hypequery — a ClickHouse semantic layer and serving runtime for Python.

Importing this package must stay cheap and side-effect free: no network calls,
no credential reads, no subprocesses, and no optional dependencies pulled in.
Submodules are deliberately *not* imported here — importing ``hypequery.serve``
eagerly would drag FastAPI into definition-only installs.
"""

from __future__ import annotations

__version__ = "0.1.0.dev0"

__all__ = ["__version__"]
