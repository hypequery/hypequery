"""Server-authored endpoint policy, never deserialized from a request."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .auth import RequestAuth
from .errors import ServeError


@dataclass(frozen=True, slots=True)
class EndpointPolicy:
    public: bool = False
    required_roles: frozenset[str] = frozenset()
    required_scopes: frozenset[str] = frozenset()
    tenant: Literal["required", "optional", "forbidden"] = "optional"
    max_limit: int = 1000

    def __post_init__(self) -> None:
        if type(self.public) is not bool:
            raise TypeError("public must be a boolean")
        if self.tenant not in ("required", "optional", "forbidden"):
            raise ValueError("invalid endpoint tenant policy")
        if type(self.max_limit) is not int or not 1 <= self.max_limit <= 100_000:
            raise ValueError("max_limit must be an integer in [1, 100000]")
        for values in (self.required_roles, self.required_scopes):
            if type(values) is not frozenset or any(type(item) is not str for item in values):
                raise TypeError("roles and scopes must be frozensets of strings")
        if self.public and (
            self.required_roles or self.required_scopes or self.tenant == "required"
        ):
            raise ValueError("public endpoints cannot require roles, scopes, or a tenant")

    def authorize(self, auth: RequestAuth | None) -> None:
        if not self.public and auth is None:
            raise ServeError(401, "UNAUTHORIZED", "Access denied")
        roles = auth.principal.roles if auth else frozenset()
        scopes = auth.principal.scopes if auth else frozenset()
        if (self.required_roles and self.required_roles.isdisjoint(roles)) or not (
            self.required_scopes <= scopes
        ):
            raise ServeError(403, "FORBIDDEN", "Access denied")
        tenant = auth.tenant if auth else None
        if self.tenant == "required" and tenant is None:
            raise ServeError(403, "FORBIDDEN", "A tenant context is required.")
        if self.tenant == "forbidden" and tenant is not None:
            raise ServeError(403, "FORBIDDEN", "This endpoint does not accept a tenant context.")


DEFAULT_ENDPOINT_POLICY = EndpointPolicy()
