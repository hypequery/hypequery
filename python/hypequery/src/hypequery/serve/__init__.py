"""FastAPI serving layer for Hypequery datasets.

Requires the ``fastapi`` extra. This module fails loudly and early rather than
letting a missing optional dependency surface as a confusing error deeper in a
request path.

Populated by train PY-D.
"""

from __future__ import annotations

try:
    import fastapi as _fastapi  # noqa: F401
except ModuleNotFoundError as exc:  # pragma: no cover - exercised in a subprocess
    raise ModuleNotFoundError(
        "hypequery.serve requires the 'fastapi' extra. "
        'Install it with: pip install "hypequery[fastapi]"'
    ) from exc

__all__: list[str] = []
