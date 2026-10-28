"""Import uvicorn for the runners, naming the extra that provides it."""

from __future__ import annotations

from types import ModuleType


def import_uvicorn() -> ModuleType:
    """The `uvicorn` module, or an actionable error when it is not installed."""

    try:
        import uvicorn
    except ModuleNotFoundError as exc:
        if exc.name != "uvicorn":
            raise
        raise ModuleNotFoundError(
            'Running a server requires uvicorn. Install it with: pip install "hypequery[server]"',
            name="uvicorn",
        ) from exc
    return uvicorn
