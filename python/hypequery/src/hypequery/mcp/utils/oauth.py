"""OAuth 2.0 resource-server pieces: RFC 9728 metadata and RFC 6750 challenges.

The authorization server (client registration, consent, token issuance) is not
part of this package; an MCP client discovers it from this metadata. Mirrors
TypeScript's `utils/http-server/oauth.ts` byte for byte on the wire.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Literal
from urllib.parse import urlsplit

_SCOPE_TOKEN = re.compile(r"^[\x21\x23-\x5B\x5D-\x7E]+$")
_LOOPBACK = frozenset({"localhost", "127.0.0.1", "[::1]", "::1"})

BearerError = Literal["invalid_token", "insufficient_scope"]


def _url(value: str, label: str) -> tuple[str, str, str]:
    """(scheme, netloc, path) of an https URL, or http on loopback."""

    if not isinstance(value, str):
        raise TypeError(f"{label} must be a URL string")
    parts = urlsplit(value)
    if not parts.scheme or not parts.netloc:
        raise ValueError(f"{label} must be an absolute URL")
    if parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in _LOOPBACK):
        raise ValueError(f"{label} must use https (http is allowed only for loopback)")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError(f"{label} must not contain credentials, a query or a fragment")
    return parts.scheme, parts.netloc, parts.path


def _scopes(values: Iterable[str], label: str) -> tuple[str, ...]:
    out: list[str] = []
    for scope in values:
        if not isinstance(scope, str) or not _SCOPE_TOKEN.match(scope):
            raise ValueError(f"{label} entries must be RFC 6749 scope tokens")
        if scope not in out:
            out.append(scope)
    return tuple(out)


@dataclass(frozen=True, slots=True)
class ProtectedResource:
    """This server as an OAuth protected resource.

    *resource* is the canonical URL of the MCP endpoint and the audience every
    accepted token must carry. *required_scopes* must all be granted, or the
    caller is refused with 403.
    """

    resource: str
    authorization_servers: tuple[str, ...]
    scopes_supported: tuple[str, ...] = ()
    required_scopes: tuple[str, ...] = ()
    resource_documentation: str | None = None
    metadata_path: str = field(init=False)
    metadata_url: str = field(init=False)
    document: Mapping[str, object] = field(init=False)

    def __post_init__(self) -> None:
        scheme, netloc, path = _url(self.resource, "resource")
        servers = tuple(self.authorization_servers)
        if not servers:
            raise ValueError("authorization_servers must name at least one authorization server")
        for server in servers:
            _url(server, "authorization_servers")
        supported = _scopes(self.scopes_supported, "scopes_supported")
        required = _scopes(self.required_scopes, "required_scopes")
        # RFC 9728 §3.1: the well-known segment goes between the host and the resource path.
        suffix = path.rstrip("/")
        metadata_path = f"/.well-known/oauth-protected-resource{suffix}"
        # Clients and token verifiers compare identifiers exactly: keep them as written.
        document: dict[str, object] = {
            "resource": self.resource,
            "authorization_servers": list(servers),
        }
        if supported:
            document["scopes_supported"] = list(supported)
        document["bearer_methods_supported"] = ["header"]
        if self.resource_documentation is not None:
            _url(self.resource_documentation, "resource_documentation")
            document["resource_documentation"] = self.resource_documentation
        object.__setattr__(self, "authorization_servers", servers)
        object.__setattr__(self, "scopes_supported", supported)
        object.__setattr__(self, "required_scopes", required)
        object.__setattr__(self, "metadata_path", metadata_path)
        object.__setattr__(self, "metadata_url", f"{scheme}://{netloc}{metadata_path}")
        object.__setattr__(self, "document", MappingProxyType(document))


def bearer_challenge(
    error: BearerError | None,
    resource: ProtectedResource | None,
    scopes: Iterable[str] = (),
) -> str:
    """An RFC 6750 ``WWW-Authenticate`` value. Error descriptions are never included."""

    params: list[str] = []
    if error is not None:
        params.append(f'error="{error}"')
    scope = " ".join(scopes)
    if error == "insufficient_scope" and scope:
        params.append(f'scope="{scope}"')
    if resource is not None:
        params.append(f'resource_metadata="{resource.metadata_url}"')
    return "Bearer" if not params else "Bearer " + ", ".join(params)
