"""A streamed body whose first chunk was read before the response was answered."""

from __future__ import annotations

from collections.abc import AsyncGenerator


class Prefixed:
    """*first*, already read, then the rest of *rest*.

    Closing it always closes *rest*, which has started: an unstarted async
    generator's ``aclose`` would skip the ``finally`` that ends the query.
    """

    def __init__(self, first: bytes, rest: AsyncGenerator[bytes, None]) -> None:
        self._first: bytes | None = first
        self._rest = rest

    def __aiter__(self) -> Prefixed:
        return self

    async def __anext__(self) -> bytes:
        if self._first is not None:
            first, self._first = self._first, None
            return first
        return await anext(self._rest)

    async def aclose(self) -> None:
        self._first = None
        await self._rest.aclose()
