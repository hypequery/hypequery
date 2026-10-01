"""Authentication for served endpoints: credentials, principals, and failures.

The host application owns authentication; this module owns the boundary around
it. A credential is read from one configured header and nowhere else, so a
token in a query string, cookie, or body is never considered. The host's
authenticator receives only that opaque credential, never the request, which is
how RFC 0009's rule holds: request input beyond the credential contributes no
role, scope, or tenant.

Failures are fixed sentences. Whether a credential was missing, malformed, or
rejected is not distinguished to the caller, and nothing a provider raised
reaches a response.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, NoReturn, TypeAlias

from fastapi import HTTPException, Request

from ..datasets.planner import TenantScope, tenant

#: Generous for a JWT, small enough that a header cannot be used to make the
#: authenticator do unbounded work.
MAX_CREDENTIAL_LENGTH = 8_192

#: RFC 6750 `b64token`: the only characters a bearer token may contain.
_BEARER_TOKEN = re.compile(r"[A-Za-z0-9\-._~+/]+=*")
_BEARER_SCHEME = "bearer"
#: Visible ASCII. An API key has no standard grammar, so this bounds it to
#: characters that cannot split a header or a log line.
_API_KEY = re.compile(r"[\x21-\x7e]+")
_HEADER_NAME = re.compile(r"[a-z0-9-]+")

CredentialKind: TypeAlias = Literal["bearer", "api-key"]


class InvalidCredential(Exception):  # noqa: N818 - named for what it means, not "Error"
    """Raise from an authenticator to reject a credential, like returning None.

    Token libraries usually raise on a bad token. Letting that exception
    escape reads as the authenticator failing, and answers a forged token with
    a retryable 503; converting it to this answers 401.
    """


@dataclass(frozen=True, slots=True)
class CredentialTransport:
    """Where a credential is read from: one header, with one grammar."""

    kind: CredentialKind
    header: str

    def __post_init__(self) -> None:
        if self.kind not in ("bearer", "api-key"):
            raise ValueError("a credential transport is 'bearer' or 'api-key'")
        if type(self.header) is not str or not _HEADER_NAME.fullmatch(self.header):
            raise ValueError("a credential header name is lowercase letters, digits, and '-'")


def bearer_token(*, header: str = "authorization") -> CredentialTransport:
    """Read `Bearer <token>` from *header*, as RFC 6750 defines it."""

    return CredentialTransport("bearer", header)


def api_key(*, header: str = "x-api-key") -> CredentialTransport:
    """Read a bare API key from *header*."""

    return CredentialTransport("api-key", header)


class Credential:
    """An opaque credential as presented, for the host's authenticator only.

    Its representation never shows the secret, so logging one is safe.
    """

    __slots__ = ("_value", "kind")

    kind: CredentialKind
    _value: str

    def __init__(self, kind: CredentialKind, value: str) -> None:
        object.__setattr__(self, "kind", kind)
        object.__setattr__(self, "_value", value)

    @property
    def value(self) -> str:
        return self._value

    def __setattr__(self, name: str, value: object) -> NoReturn:
        raise AttributeError("a Credential is immutable")

    def __reduce__(self) -> NoReturn:
        raise TypeError("a Credential cannot be serialized")

    def __repr__(self) -> str:
        return f"Credential({self.kind}, <redacted>)"


@dataclass(frozen=True, slots=True)
class Principal:
    """The canonical auth context: who the authenticator says the caller is.

    Only the host's authenticator produces one, and it is not a Pydantic model,
    so no request body can be coerced into it. `tenant_id` is what the default
    tenant resolver scopes the request to.
    """

    subject: str
    roles: frozenset[str] = frozenset()
    scopes: frozenset[str] = frozenset()
    tenant_id: str | None = None

    def __post_init__(self) -> None:
        if type(self.subject) is not str or not self.subject:
            raise TypeError("a principal subject must be a non-empty string")
        for label, values in (("roles", self.roles), ("scopes", self.scopes)):
            if type(values) is not frozenset or any(type(item) is not str for item in values):
                raise TypeError(f"principal {label} must be a frozenset of strings")
        if self.tenant_id is not None and (type(self.tenant_id) is not str or not self.tenant_id):
            raise TypeError("a principal tenant_id must be a non-empty string or None")

    def __repr__(self) -> str:
        # Subjects are often emails and tenant ids are RFC 0009 tenant values;
        # neither belongs in a log line.
        return f"Principal(<redacted>, roles={len(self.roles)}, scopes={len(self.scopes)})"


@dataclass(frozen=True, slots=True)
class RequestAuth:
    """What an authenticated endpoint receives: the principal and its tenant."""

    principal: Principal
    tenant: TenantScope | None = None

    def __post_init__(self) -> None:
        if type(self.principal) is not Principal:
            raise TypeError("RequestAuth.principal must be a Principal")
        if self.tenant is not None and (
            type(self.tenant) is not TenantScope
            or self.tenant.cross_tenant
            or len(self.tenant.ids) != 1
        ):
            # RFC 0009: a request has exactly one tenant context.
            raise TypeError("RequestAuth.tenant must be a single-tenant capability")


#: Returns the principal, or None to reject the credential. Sync or async.
Authenticator: TypeAlias = Callable[[Credential], Awaitable[Principal | None] | Principal | None]
#: Returns the tenant capability, or None for a tenant-free request. Sync or async.
TenantResolver: TypeAlias = Callable[
    [Principal], Awaitable[TenantScope | None] | TenantScope | None
]


def default_tenant_resolver(principal: Principal) -> TenantScope | None:
    """Scope the request to the principal's `tenant_id`, or to no tenant."""

    return tenant(principal.tenant_id) if principal.tenant_id is not None else None


def unauthenticated(transport: CredentialTransport) -> HTTPException:
    headers = {"Cache-Control": "no-store"}
    if transport.kind == "bearer" and transport.header == "authorization":
        headers["WWW-Authenticate"] = "Bearer"
    return HTTPException(
        401,
        detail={"category": "unauthenticated", "message": "Authentication required."},
        headers=headers,
    )


def unavailable() -> HTTPException:
    return HTTPException(
        503,
        detail={"category": "unavailable", "message": "Authentication is unavailable."},
        headers={"Cache-Control": "no-store"},
    )


def misconfigured() -> HTTPException:
    return HTTPException(
        500,
        detail={"category": "internal", "message": "The request could not be authenticated."},
        headers={"Cache-Control": "no-store"},
    )


def read_credential(request: Request, transport: CredentialTransport) -> Credential | None:
    """The credential in *transport*'s header, or None when absent or malformed.

    More than one copy of the header is refused rather than picking one: two
    components disagreeing about which copy counts is how credentials get
    confused.
    """

    values = request.headers.getlist(transport.header)
    if len(values) != 1:
        return None
    raw = values[0]
    if len(raw) > MAX_CREDENTIAL_LENGTH:
        return None
    if transport.kind == "api-key":
        return Credential("api-key", raw) if _API_KEY.fullmatch(raw) else None
    scheme, _, token = raw.partition(" ")
    if scheme.lower() != _BEARER_SCHEME:
        return None
    token = token.lstrip(" ")
    return Credential("bearer", token) if _BEARER_TOKEN.fullmatch(token) else None
