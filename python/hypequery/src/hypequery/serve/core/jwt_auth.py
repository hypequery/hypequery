"""JWT bearer authentication and the analytics token issuer (decision 0023 §3).

`jwt_strategy` is TypeScript's `createJwtStrategy` and `analytics_token_issuer`
is `createAnalyticsTokenIssuer`. Tokens either language mints verify in the
other, and both refuse the same bad tokens: `specs/serve-http/fixtures/jwt-v1`
pins that.

PyJWT verifies signatures (the `jwt` extra). It is imported when a strategy or
issuer is created, so the core and a base install import without it. Claims are
checked by `utils/jwt_claims.py`, which follows jose rather than PyJWT where the
two differ, and keys are chosen from a key set by `utils/jwk_selection.py`.
"""

from __future__ import annotations

import inspect
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping
from datetime import timedelta
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, TypeAlias

from .auth import Credential, InvalidCredential, Principal
from .jwks import JwksUnavailable, RemoteJwks
from .utils.jwk_selection import has_private_material, matching_keys
from .utils.jwt_claims import claims_valid, default_principal, parse_claims
from .utils.jwt_options import (
    algorithm_list,
    check_asymmetric,
    check_hmac,
    check_jwks_url,
    seconds,
    secret_bytes,
    string_set,
)

if TYPE_CHECKING:
    from types import ModuleType

    from jwt import PyJWK, PyJWS

#: Maps verified claims to the principal, or None to refuse the token. Sync or
#: async; it runs on the event loop, so it must not block.
ClaimsMapper: TypeAlias = Callable[
    [Mapping[str, Any]], Awaitable[Principal | None] | Principal | None
]


def _clock() -> int:
    """Seconds since the epoch, whole, as jose's `epoch()` counts them."""

    return int(time.time())


def _pyjwt(*, asymmetric: bool = False) -> ModuleType:
    try:
        import jwt
        import jwt.algorithms
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "JWT authentication requires the 'jwt' extra. "
            'Install it with: pip install "hypequery[jwt]"'
        ) from exc
    if asymmetric and not jwt.algorithms.has_crypto:
        raise ModuleNotFoundError(
            "Verifying with a key set requires the 'cryptography' package from the 'jwt' "
            'extra. Install it with: pip install "hypequery[jwt]"'
        )
    return jwt


class JwtStrategy:
    """Verifies a bearer JWT and maps its claims to a `Principal`.

    It is an `Authenticator`: pass it as `authenticate=` to `create_api` or
    `create_router`. It reads the credential the API's credential transport
    delivers, `bearer_token()` by default.

    A token that fails verification is refused with 401. A key set that
    cannot be fetched answers 503, because no token was judged.
    """

    __slots__ = (
        "_algorithms",
        "_audiences",
        "_imported",
        "_issuers",
        "_jwk",
        "_jws",
        "_keys",
        "_leeway",
        "_map_claims",
        "_token_error",
    )

    def __init__(
        self,
        *,
        jwt: ModuleType,
        algorithms: tuple[str, ...],
        keys: bytes | RemoteJwks,
        issuers: tuple[str, ...],
        audiences: tuple[str, ...],
        leeway: float,
        map_claims: ClaimsMapper,
    ) -> None:
        self._algorithms = algorithms
        self._keys = keys
        self._issuers = issuers
        self._audiences = audiences
        self._leeway = leeway
        self._map_claims = map_claims
        # An RSA key under 2048 bits is refused, as jose refuses it.
        self._jws: PyJWS = jwt.PyJWS(
            algorithms=list(algorithms), options={"enforce_minimum_key_length": True}
        )
        self._jwk: type[PyJWK] = jwt.PyJWK
        self._token_error: type[Exception] = jwt.PyJWTError
        # Imported keys, per key-set member and algorithm, for the current set.
        self._imported: dict[tuple[int, str], tuple[Mapping[str, Any], PyJWK]] = {}

    @property
    def jwks_url(self) -> str | None:
        return self._keys.url if isinstance(self._keys, RemoteJwks) else None

    async def __call__(self, credential: Credential) -> Principal | None:
        claims = await self._verify(credential.value)
        principal = self._map_claims(MappingProxyType(claims))
        if inspect.isawaitable(principal):
            principal = await principal
        return principal

    async def _verify(self, token: str) -> dict[str, Any]:
        try:
            header = self._jws.get_unverified_header(token)
        except self._token_error:
            raise InvalidCredential from None
        alg = header.get("alg")
        # Checked before any key is looked up, as jose does, so a token with
        # a disallowed algorithm never makes the server fetch a key set.
        if type(alg) is not str or alg not in self._algorithms:
            raise InvalidCredential
        key: bytes | PyJWK = (
            self._keys
            if isinstance(self._keys, bytes)
            else (await self._key(self._keys, alg, header.get("kid")))
        )
        try:
            decoded = self._jws.decode_complete(token, key=key, algorithms=[alg])
        except self._token_error:
            raise InvalidCredential from None
        claims = parse_claims(decoded["payload"])
        if claims is None or not claims_valid(
            claims,
            now=_clock(),
            issuers=self._issuers,
            audiences=self._audiences,
            leeway=self._leeway,
        ):
            raise InvalidCredential
        return claims

    async def _key(self, jwks: RemoteJwks, alg: str, kid: object) -> PyJWK:
        keys = await jwks.keys()
        candidates = matching_keys(keys, alg, kid)
        if not candidates and not jwks.cooling_down():
            # An unknown key may be a rotation the cached set predates.
            keys = await jwks.reload()
            candidates = matching_keys(keys, alg, kid)
        # More than one candidate (no `kid`, several keys) is refused, as jose
        # refuses it, rather than trying each.
        if len(candidates) != 1 or has_private_material(candidates[0]):
            raise InvalidCredential
        return self._import(candidates[0], alg)

    def _import(self, jwk: Mapping[str, Any], alg: str) -> PyJWK:
        slot = (id(jwk), alg)
        cached = self._imported.get(slot)
        if cached is not None and cached[0] is jwk:
            return cached[1]
        try:
            key = self._jwk(dict(jwk), algorithm=alg)
        except self._token_error:
            raise InvalidCredential from None
        if len(self._imported) > 64:
            self._imported.clear()
        # The member itself is kept with its key, so its id is never reused
        # by another while the entry lives.
        self._imported[slot] = (jwk, key)
        return key


def jwt_strategy(
    *,
    secret: str | bytes | None = None,
    jwks_url: str | None = None,
    issuer: str | Iterable[str] | None = None,
    audience: str | Iterable[str] | None = None,
    algorithms: Iterable[str] | None = None,
    leeway: timedelta | float = 0,
    map_claims: ClaimsMapper | None = None,
    jwks_timeout: timedelta | float = 5,
    jwks_cache_max_age: timedelta | float = 600,
    jwks_cooldown: timedelta | float = 30,
) -> JwtStrategy:
    """Verify JWT bearer tokens with a shared *secret* or a remote key set.

    Use a secret when you mint tokens yourself (`analytics_token_issuer`), and
    *jwks_url* when a provider such as Auth0, Clerk or Cognito mints them.
    Exactly one is required. *algorithms* defaults to HS256 for a secret and
    RS256 for a key set; `none` is never accepted, and a key set never
    verifies an HMAC algorithm.

    *issuer* and *audience*, when given, must match the token's `iss` and
    `aud` (one value or several). *leeway* tolerates clock skew in `exp` and
    `nbf`; TypeScript allows none, the default.

    By default claims map as TypeScript maps them: `sub` to the subject,
    `org_id` to the tenant, `roles` to roles and `scope` (space-separated) or
    `scopes` (an array) to scopes. A token without `sub` is refused. Pass
    *map_claims* to map them yourself; it returns a `Principal`, or None to
    refuse the token.

    A key set is cached for *jwks_cache_max_age* and refetched for an unknown
    key at most once per *jwks_cooldown*. Each fetch runs off the event loop,
    is bounded by *jwks_timeout* and follows no redirect. Defaults match jose:
    5 seconds, 10 minutes and 30 seconds. *jwks_url* must be https except for a
    loopback host.
    """

    if (secret is None) == (jwks_url is None):
        raise ValueError("jwt_strategy: provide exactly one of `secret` or `jwks_url`")
    if map_claims is not None and not callable(map_claims):
        raise TypeError("jwt_strategy: map_claims must be callable")
    issuers = string_set(issuer, "jwt_strategy: issuer")
    audiences = string_set(audience, "jwt_strategy: audience")
    tolerance = seconds(leeway, "jwt_strategy: leeway", minimum=0)
    if secret is not None:
        key = secret_bytes(secret, "jwt_strategy")
        names = algorithm_list(algorithms, "HS256", "jwt_strategy")
        check_hmac(names, key, "jwt_strategy")
        return JwtStrategy(
            jwt=_pyjwt(),
            algorithms=names,
            keys=key,
            issuers=issuers,
            audiences=audiences,
            leeway=tolerance,
            map_claims=map_claims or default_principal,
        )
    url = check_jwks_url(jwks_url)
    names = algorithm_list(algorithms, "RS256", "jwt_strategy")
    check_asymmetric(names, "jwt_strategy")
    jwks = RemoteJwks(
        url,
        timeout=seconds(jwks_timeout, "jwt_strategy: jwks_timeout", minimum=0.001),
        cache_max_age=seconds(jwks_cache_max_age, "jwt_strategy: jwks_cache_max_age", minimum=0),
        cooldown=seconds(jwks_cooldown, "jwt_strategy: jwks_cooldown", minimum=0),
    )
    return JwtStrategy(
        jwt=_pyjwt(asymmetric=True),
        algorithms=names,
        keys=jwks,
        issuers=issuers,
        audiences=audiences,
        leeway=tolerance,
        map_claims=map_claims or default_principal,
    )


class AnalyticsTokenIssuer:
    """Mints short-lived HMAC tokens for a frontend, as TypeScript does.

    Call it with the subject and, optionally, the tenant and roles. The token
    carries `sub`, `org_id`, `roles`, `iat`, `exp` and the configured `iss` and
    `aud`, and verifies with `jwt_strategy(secret=...)` in Python or
    `createJwtStrategy({ secret })` in TypeScript.
    """

    __slots__ = ("_algorithm", "_audience", "_encode", "_expires_in", "_issuer", "_secret")

    def __init__(
        self,
        *,
        jwt: ModuleType,
        secret: bytes,
        algorithm: str,
        expires_in: int,
        issuer: str | None,
        audience: str | None,
    ) -> None:
        self._encode: Callable[..., str] = jwt.encode
        self._secret = secret
        self._algorithm = algorithm
        self._expires_in = expires_in
        self._issuer = issuer
        self._audience = audience

    def __repr__(self) -> str:
        return f"AnalyticsTokenIssuer({self._algorithm}, <redacted>)"

    def __call__(
        self, subject: str, *, tenant_id: str | None = None, roles: Iterable[str] | None = None
    ) -> str:
        if type(subject) is not str or not subject:
            raise ValueError("a token subject must be a non-empty string")
        # TypeScript drops an empty tenant id, minting a tenant-free token for
        # what was meant to be a tenant's. Refuse it instead.
        if tenant_id is not None and (type(tenant_id) is not str or not tenant_id):
            raise ValueError("a token tenant_id must be a non-empty string or None")
        claims: dict[str, Any] = {}
        if tenant_id is not None:
            claims["org_id"] = tenant_id
        if roles is not None:
            if isinstance(roles, str):
                raise TypeError("roles must be a sequence of strings, not a string")
            listed = list(roles)
            if any(type(role) is not str for role in listed):
                raise TypeError("roles must be strings")
            claims["roles"] = listed
        issued_at = _clock()
        claims["sub"] = subject
        claims["iat"] = issued_at
        claims["exp"] = issued_at + self._expires_in
        if self._issuer is not None:
            claims["iss"] = self._issuer
        if self._audience is not None:
            claims["aud"] = self._audience
        return self._encode(claims, self._secret, algorithm=self._algorithm)


def analytics_token_issuer(
    secret: str | bytes,
    *,
    expires_in: timedelta | int = timedelta(minutes=15),
    issuer: str | None = None,
    audience: str | None = None,
    algorithm: str = "HS256",
) -> AnalyticsTokenIssuer:
    """Mint tokens your frontend presents to an API using `jwt_strategy(secret=...)`.

    `issue = analytics_token_issuer(secret, issuer=..., audience=...)`, then
    `issue("user-1", tenant_id="acme", roles=["analyst"])`. Tokens expire after
    *expires_in*, 15 minutes by default, and are signed with *algorithm*
    (HS256, HS384 or HS512). The secret must be at least as long as the hash:
    32 bytes for HS256.
    """

    key = secret_bytes(secret, "analytics_token_issuer")
    check_hmac((algorithm,), key, "analytics_token_issuer")
    lifetime = seconds(expires_in, "analytics_token_issuer: expires_in", minimum=1)
    for name, value in (("issuer", issuer), ("audience", audience)):
        if value is not None and (type(value) is not str or not value):
            raise ValueError(f"analytics_token_issuer: {name} must be a non-empty string")
    return AnalyticsTokenIssuer(
        jwt=_pyjwt(),
        secret=key,
        algorithm=algorithm,
        expires_in=int(lifetime),
        issuer=issuer,
        audience=audience,
    )


__all__ = [
    "AnalyticsTokenIssuer",
    "ClaimsMapper",
    "JwksUnavailable",
    "JwtStrategy",
    "analytics_token_issuer",
    "jwt_strategy",
]
