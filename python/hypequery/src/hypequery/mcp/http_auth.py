"""Who is calling the self-hosted HTTP MCP server.

An authenticator turns a request's headers into an `McpPrincipal`. The tenant
is decided here, from a verified credential, never from tool arguments. The
counterpart of TypeScript's `http-auth.ts`.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Literal, Protocol

from ..serve import Api
from ..serve.core.authentication import Authentication
from ..serve.core.errors import ServeError
from ..serve.core.jwt_auth import JwtStrategy
from ..serve.core.messages import Headers, ServeRequest
from ..serve.core.state import RequestState

McpAuthErrorCode = Literal["invalid_token", "insufficient_scope"]

_BEARER = re.compile(r"^Bearer[ \t]+(\S+)[ \t]*$", re.IGNORECASE)
_MIN_STATIC_KEY_LENGTH = 16


@dataclass(frozen=True, slots=True)
class McpPrincipal:
    """The verified caller behind one HTTP MCP session."""

    subject: str
    tenant_id: str | None = None
    scopes: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if type(self.subject) is not str or not self.subject:
            raise TypeError("an MCP principal subject must be a non-empty string")
        if self.tenant_id is not None and (type(self.tenant_id) is not str or not self.tenant_id):
            raise TypeError("an MCP principal tenant_id must be a non-empty string or None")
        if type(self.scopes) is not frozenset or any(type(s) is not str for s in self.scopes):
            raise TypeError("MCP principal scopes must be a frozenset of strings")

    @property
    def owner(self) -> str:
        """What a session belongs to: a refreshed token for the same subject and tenant keeps it."""

        return repr((self.subject, self.tenant_id))

    def __repr__(self) -> str:
        return f"McpPrincipal(<redacted>, scopes={len(self.scopes)})"


class McpAuthError(Exception):
    """Refuse a presented credential. Only *code* reaches the client."""

    def __init__(
        self, code: McpAuthErrorCode, message: str | None = None, *, scopes: Iterable[str] = ()
    ) -> None:
        super().__init__(message or code)
        self.code: McpAuthErrorCode = code
        self.scopes = tuple(scopes)


class McpAuthenticator(Protocol):
    """Authenticates one request from its lower-cased headers.

    Return the principal, None when no credential is presented, or raise
    `McpAuthError` to refuse one. *credential_headers* names the request
    headers an in-process backend may receive, so the API re-checks the same
    credential on every query; it is empty when nothing is forwarded.
    """

    @property
    def credential_headers(self) -> tuple[str, ...]: ...

    async def __call__(self, headers: Mapping[str, str]) -> McpPrincipal | None: ...


def bearer_token(value: str | None) -> str | None:
    """The Bearer token in an ``Authorization`` value, or None when none is presented."""

    if value is None:
        return None
    match = _BEARER.match(value)
    return match.group(1) if match else None


@dataclass(frozen=True, slots=True)
class StaticKeyAuthenticator:
    """One shared key for one principal: ``Authorization: Bearer <key>``."""

    key: str
    principal: McpPrincipal
    credential_headers: tuple[str, ...] = ()

    def __repr__(self) -> str:
        return "StaticKeyAuthenticator(<redacted>)"

    async def __call__(self, headers: Mapping[str, str]) -> McpPrincipal | None:
        token = bearer_token(headers.get("authorization"))
        if token is None:
            return None
        # Hash both sides first so the comparison runs over equal-length values.
        presented = hashlib.sha256(token.encode()).digest()
        expected = hashlib.sha256(self.key.encode()).digest()
        if not hmac.compare_digest(presented, expected):
            raise McpAuthError("invalid_token")
        return self.principal


def static_key_authenticator(
    key: str,
    *,
    subject: str = "static-key",
    tenant_id: str | None = None,
    scopes: Iterable[str] = (),
) -> StaticKeyAuthenticator:
    """Accept one shared *key*; every caller is the same principal, with *tenant_id*."""

    if not isinstance(key, str) or len(key.strip()) < _MIN_STATIC_KEY_LENGTH:
        raise ValueError(f"the static MCP key must be at least {_MIN_STATIC_KEY_LENGTH} characters")
    principal = McpPrincipal(subject=subject, tenant_id=tenant_id, scopes=frozenset(scopes))
    return StaticKeyAuthenticator(key=key.strip(), principal=principal)


class ApiAuthenticator:
    """Reuse a `hypequery.serve` Api's own authentication and tenant resolution.

    The request's credential header is checked by the API's strategy, such as
    `jwt_strategy` for OAuth access tokens, and the principal's tenant is what
    the API's tenant resolver returns. The same header is then forwarded on
    every query, so the API authorizes each call as it would over REST.
    """

    __slots__ = ("_authentication", "credential_headers")

    def __init__(self, api: Api) -> None:
        if not isinstance(api, Api):
            raise TypeError("ApiAuthenticator authenticates with a hypequery.serve Api")
        authentication: Authentication = api.authentication
        transport = authentication.credentials
        if authentication.context is not None or transport is None:
            raise ValueError(
                "MCP over HTTP needs a header credential; this API authenticates from the "
                "host's session (from_context), which an MCP client cannot send."
            )
        self._authentication = authentication
        self.credential_headers: tuple[str, ...] = (transport.header,)

    @property
    def audiences(self) -> tuple[str, ...] | None:
        """The JWT audiences the API's strategy accepts, or None when it is not a JWT strategy."""

        strategy = self._authentication.authenticate
        return strategy.audiences if isinstance(strategy, JwtStrategy) else None

    async def __call__(self, headers: Mapping[str, str]) -> McpPrincipal | None:
        header = self.credential_headers[0]
        if header not in headers:
            return None
        request = ServeRequest(
            method="POST",
            path="/mcp",
            headers=Headers([(header, headers[header])]),
            client=("127.0.0.1", 0),
            scheme="https",
        )
        try:
            auth = await self._authentication(request, RequestState(request_id=uuid.uuid4().hex))
        except ServeError as error:
            if error.status_code == 401:
                raise McpAuthError("invalid_token") from None
            raise
        tenant = auth.tenant.ids[0] if auth.tenant is not None else None
        return McpPrincipal(
            subject=auth.principal.subject, tenant_id=tenant, scopes=auth.principal.scopes
        )
