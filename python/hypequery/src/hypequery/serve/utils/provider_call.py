"""Run synchronous and asynchronous host providers under request work tracking."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from typing import TypeVar

from fastapi import Request

from ..auth import InvalidCredential, unavailable
from .request_work import run_sync

_Argument = TypeVar("_Argument")
_Result = TypeVar("_Result")


def _is_async(provider: Callable[..., object]) -> bool:
    call = getattr(provider, "__call__", None)  # noqa: B004 - a callable instance's method
    return inspect.iscoroutinefunction(provider) or inspect.iscoroutinefunction(call)


async def call_provider(
    provider: Callable[[_Argument], _Result | Awaitable[_Result]],
    argument: _Argument,
    request: Request,
    *,
    rejectable: bool = False,
) -> _Result:
    """Run a host provider, failing closed and silent if it raises.

    An authenticator rejects a credential by returning None or raising
    `InvalidCredential`; with *rejectable* that exception passes through for
    the caller to answer 401. Any other exception, even an HTTPException, is
    the provider failing.

    A sync provider runs in the threadpool, as FastAPI runs a sync dependency:
    a token lookup that blocks must not stall every request on the loop.
    """

    try:
        if _is_async(provider):
            result = provider(argument)
        else:
            result = await run_sync(request, provider, argument)
        if inspect.isawaitable(result):
            return await result
        return result
    except InvalidCredential:
        if rejectable:
            raise
        raise unavailable() from None
    except Exception as exc:
        # The provider's exception may carry a token, a claim, or a backend
        # address. It stays the cause for a trusted debugger and never
        # becomes response content.
        raise unavailable() from exc
