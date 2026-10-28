"""JWT claims: parse, validate and map to a `Principal`, as TypeScript's `jose` does.

The signature is PyJWT's job. What a verified payload must contain, and what it
means, is defined here so that it matches `@hypequery/serve`'s
`createJwtStrategy` (jose 5) rule for rule, which PyJWT's own claim checks do
not. The shared fixtures in `specs/serve-http/fixtures/jwt-v1` pin both.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from ..auth import Principal
from .json_body import parse_json


def parse_claims(payload: bytes) -> dict[str, Any] | None:
    """The claims set, or None when it is not a top-level JSON object.

    `NaN` and `Infinity` are refused, as jose refuses them: an `exp` of
    Infinity would otherwise never expire.
    """

    try:
        claims = parse_json(payload)
    except (ValueError, RecursionError):
        return None
    return claims if type(claims) is dict else None


def _is_number(value: object) -> bool:
    # JSON true is a bool in Python, which is an int; jose sees a boolean.
    # A float literal too large for a double reads as infinity; refuse it.
    return type(value) is int or (type(value) is float and math.isfinite(value))


def claims_valid(
    claims: Mapping[str, Any],
    *,
    now: int,
    issuers: Sequence[str],
    audiences: Sequence[str],
    leeway: float,
) -> bool:
    """Whether *claims* pass jose's `jwtVerify` checks at *now* (whole seconds).

    - `iss` must be one of *issuers* and `aud` (a string, or an array with any
      member) one of *audiences*, when those are configured; neither is
      checked otherwise.
    - `iat`, `nbf` and `exp` must be numbers when present. A token is refused
      once `exp <= now - leeway`, and before `nbf > now + leeway`. `iat` is not
      compared with the clock, and `exp` is not required.
    """

    if issuers and claims.get("iss") not in issuers:
        return False
    if audiences and not _audience_matches(claims.get("aud"), audiences):
        return False
    for claim in ("iat", "nbf", "exp"):
        if claim in claims and not _is_number(claims[claim]):
            return False
    if "nbf" in claims and claims["nbf"] > now + leeway:
        return False
    return not ("exp" in claims and claims["exp"] <= now - leeway)


def _audience_matches(claim: object, audiences: Sequence[str]) -> bool:
    if type(claim) is str:
        return claim in audiences
    if type(claim) is list:
        return any(type(item) is str and item in audiences for item in claim)
    return False


def _strings(value: object) -> frozenset[str]:
    if type(value) is not list:
        return frozenset()
    return frozenset(item for item in value if type(item) is str)


def default_principal(claims: Mapping[str, Any]) -> Principal | None:
    """TypeScript's default claim mapping, onto a `Principal`.

    `sub` is the subject, `org_id` the tenant, `roles` the roles and `scope`
    (space-separated) or `scopes` (an array) the scopes. Values of the wrong
    type are dropped, as TypeScript drops them.

    A `Principal` needs a subject, so a token without a string `sub` is
    refused where TypeScript would accept it with no user id. An empty
    `org_id` is refused rather than read as "no tenant".
    """

    subject = claims.get("sub")
    if type(subject) is not str or not subject:
        return None
    tenant_id = claims.get("org_id")
    if type(tenant_id) is not str:
        tenant_id = None
    elif not tenant_id:
        return None
    scope = claims.get("scope")
    if scope is None:
        scope = claims.get("scopes")
    if type(scope) is str:
        scopes = frozenset(item for item in scope.split(" ") if item)
    else:
        scopes = _strings(scope)
    return Principal(
        subject=subject, roles=_strings(claims.get("roles")), scopes=scopes, tenant_id=tenant_id
    )
