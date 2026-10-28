"""The core's request work, kept per ASGI request for the FastAPI layer."""

from __future__ import annotations

from collections.abc import Callable
from typing import ParamSpec, TypeVar

from fastapi import Request

from ..core.work import RequestWork
from ..core.work import run_sync as run_tracked
from .scope_slot import ScopeSlot

_P = ParamSpec("_P")
_T = TypeVar("_T")

_WORK_SLOT = ScopeSlot(RequestWork)


def request_work(request: Request) -> RequestWork:
    return _WORK_SLOT.setdefault(request.scope, RequestWork)


async def run_sync(
    request: Request, function: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs
) -> _T:
    return await run_tracked(request_work(request), function, *args, **kwargs)
