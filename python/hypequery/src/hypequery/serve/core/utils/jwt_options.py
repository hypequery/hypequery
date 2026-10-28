"""Validate the options of `jwt_strategy` and `analytics_token_issuer`.

Everything a misconfiguration could weaken is refused when the strategy or
issuer is created, not discovered on the first request.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from datetime import timedelta
from urllib.parse import urlsplit

#: RFC 7518 §3.2: an HMAC key is at least as long as the hash output.
HMAC_MIN_KEY_BYTES = {"HS256": 32, "HS384": 48, "HS512": 64}
#: Algorithms a JSON Web Key Set may verify. Never `none`, never HMAC: a key
#: set holds public keys, and HMAC with a public key is the confusion attack.
ASYMMETRIC_ALGORITHMS = frozenset(
    ("RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA")
)
_LOOPBACK = frozenset(("localhost", "127.0.0.1", "::1"))


def seconds(value: timedelta | float, name: str, *, minimum: float) -> float:
    """*value* in seconds: a `timedelta` or a number, at least *minimum*."""

    if isinstance(value, timedelta):
        amount = value.total_seconds()
    elif type(value) in (int, float):
        amount = float(value)
    else:
        raise TypeError(f"{name} must be a timedelta or a number of seconds")
    if not math.isfinite(amount) or amount < minimum:
        raise ValueError(f"{name} must be at least {minimum:g} seconds")
    return amount


def secret_bytes(secret: str | bytes, helper: str) -> bytes:
    """A shared secret as bytes; text is UTF-8, as TypeScript encodes it."""

    if isinstance(secret, str):
        key = secret.encode("utf-8")
    elif isinstance(secret, bytes):
        key = secret
    else:
        raise TypeError(f"{helper}: secret must be str or bytes")
    if not key:
        raise ValueError(f"{helper}: secret must not be empty")
    return key


def check_hmac(algorithms: Sequence[str], key: bytes, helper: str) -> None:
    """Refuse non-HMAC algorithms for a shared secret, and secrets too short."""

    for algorithm in algorithms:
        minimum = HMAC_MIN_KEY_BYTES.get(algorithm)
        if minimum is None:
            raise ValueError(
                f"{helper}: a secret verifies HS256, HS384 or HS512, not {algorithm!r}"
            )
        if len(key) < minimum:
            raise ValueError(
                f"{helper}: an {algorithm} secret must be at least {minimum} bytes "
                f"(RFC 7518 §3.2); this one is {len(key)}"
            )


def check_asymmetric(algorithms: Sequence[str], helper: str) -> None:
    for algorithm in algorithms:
        if algorithm not in ASYMMETRIC_ALGORITHMS:
            raise ValueError(
                f"{helper}: a key set verifies "
                f"{', '.join(sorted(ASYMMETRIC_ALGORITHMS))}; not {algorithm!r}"
            )


def algorithm_list(algorithms: Iterable[str] | None, default: str, helper: str) -> tuple[str, ...]:
    if algorithms is None:
        return (default,)
    if isinstance(algorithms, str):
        raise TypeError(f"{helper}: algorithms must be a sequence of names, not a string")
    names = tuple(algorithms)
    if not names or any(type(name) is not str for name in names):
        raise ValueError(f"{helper}: algorithms must be a non-empty sequence of names")
    return names


def string_set(value: str | Iterable[str] | None, name: str) -> tuple[str, ...]:
    """An expected issuer or audience: one string or several, none empty."""

    if value is None:
        return ()
    values = (value,) if isinstance(value, str) else tuple(value)
    if not values or any(type(item) is not str or not item for item in values):
        raise ValueError(f"{name} must be a non-empty string or a non-empty sequence of them")
    return values


def check_jwks_url(url: object) -> str:
    """An https URL, or http to a loopback host for development."""

    if type(url) is not str or not url.strip():
        raise ValueError("jwt_strategy: jwks_url must not be empty")
    parts = urlsplit(url)
    if not parts.hostname or parts.scheme not in ("https", "http"):
        raise ValueError("jwt_strategy: jwks_url must be an http(s) URL")
    if parts.scheme == "http" and parts.hostname not in _LOOPBACK:
        # Whoever can change the key set in transit can sign any token.
        raise ValueError("jwt_strategy: jwks_url must use https outside localhost")
    return url
