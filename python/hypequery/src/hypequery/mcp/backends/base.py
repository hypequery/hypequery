"""The two calls an MCP executor makes of its backend."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

#: One principal's credentials; a callable may rotate them for that same principal.
BackendHeaders = Mapping[str, str] | Callable[[], Mapping[str, str]]


@dataclass(frozen=True, slots=True)
class BackendResponse:
    """A backend answer whose body was read within its byte budget."""

    status: int
    content_type: str | None = None
    body: bytes = b""
    #: The body was cut off at the budget, or its declared length exceeded it.
    oversized: bool = False


class ContractBackend(Protocol):
    """An authorized client-contract API, over HTTP or in this process."""

    async def discover(self, max_bytes: int) -> BackendResponse:
        """GET the caller's authorized client contract."""
        ...

    async def query(
        self, path: str, body: Mapping[str, object], schema_hash: str, max_bytes: int
    ) -> BackendResponse:
        """POST a validated plan to an endpoint path named by the contract."""
        ...


def resolve_headers(headers: BackendHeaders | None) -> dict[str, str]:
    configured = headers() if callable(headers) else headers
    return {name.lower(): value for name, value in (configured or {}).items()}
