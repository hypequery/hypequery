"""RFC 0013 cache key derivation.

A query's canonical preimage identifies it; the store key only addresses it.
The store key is an HMAC under a per-namespace secret, so a reader of a shared
store's key space learns nothing about what was queried. The preimage never
leaves the process.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from typing import Final, Literal, NoReturn, TypeAlias

from .errors import ProtocolDeploymentReleaseError
from .releases import validate_protocol_deployment_release_target
from .utf8 import encode_utf8, exceeds_utf8_byte_limit

ProtocolCacheKeyErrorCode: TypeAlias = Literal[
    "HQ_CACHE_KEY_SECRET_MISSING",
    "HQ_CACHE_KEY_SECRET_TOO_SHORT",
    "HQ_CACHE_KEY_INVALID_NAMESPACE",
    "HQ_CACHE_KEY_INVALID_VERSION",
    "HQ_CACHE_KEY_PREIMAGE_TOO_LARGE",
]

MIN_CACHE_KEY_SECRET_BYTES: Final = 32
MAX_CACHE_KEY_PREIMAGE_BYTES: Final = 1_048_576
MIN_CACHE_KEY_VERSION: Final = 1
MAX_CACHE_KEY_VERSION: Final = 2_147_483_647
MAX_CACHE_STORE_KEY_BYTES: Final = 128

_SCHEME: Final = "hq1"
_NAMESPACE_DOMAIN: Final = b"hypequery.cache.namespace.v1"
_ENTRY_DOMAIN: Final = b"hypequery.cache.entry.v1"
_NAMESPACE_TOKEN_BYTES: Final = 16


class ProtocolCacheKeyError(ValueError):
    """A stable RFC 0013 failure.

    The message is the code and nothing else: the secret and the preimage are
    both in scope wherever this is raised, and neither may reach a log.
    """

    code: ProtocolCacheKeyErrorCode

    def __init__(self, code: ProtocolCacheKeyErrorCode) -> None:
        super().__init__(code)
        self.code = code


def _fail(code: ProtocolCacheKeyErrorCode) -> NoReturn:
    raise ProtocolCacheKeyError(code)


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _require_secret(secret: bytes | None) -> bytes:
    if secret is None or len(secret) == 0:
        _fail("HQ_CACHE_KEY_SECRET_MISSING")
    if type(secret) is not bytes:
        raise TypeError("a cache-key secret must be bytes")
    if len(secret) < MIN_CACHE_KEY_SECRET_BYTES:
        _fail("HQ_CACHE_KEY_SECRET_TOO_SHORT")
    return secret


def _require_namespace(project: object, environment: object) -> tuple[bytes, bytes]:
    try:
        target = validate_protocol_deployment_release_target(
            {"project": project, "environment": environment}
        )
    except ProtocolDeploymentReleaseError:
        # One code, not the release validator's detail: callers have no reason
        # to branch on why a namespace is invalid.
        _fail("HQ_CACHE_KEY_INVALID_NAMESPACE")
    return encode_utf8(str(target["project"])), encode_utf8(str(target["environment"]))


def _require_key_version(key_version: object) -> int:
    if (
        type(key_version) is not int
        or not MIN_CACHE_KEY_VERSION <= key_version <= MAX_CACHE_KEY_VERSION
    ):
        _fail("HQ_CACHE_KEY_INVALID_VERSION")
    return key_version


def _require_preimage(preimage: bytes | str) -> bytes:
    if type(preimage) is str:
        # The bound is checked before encoding, so an oversized preimage is
        # refused without allocating its UTF-8 form.
        if exceeds_utf8_byte_limit(preimage, MAX_CACHE_KEY_PREIMAGE_BYTES):
            _fail("HQ_CACHE_KEY_PREIMAGE_TOO_LARGE")
        return encode_utf8(preimage)
    if type(preimage) is not bytes:
        raise TypeError("a cache-key preimage must be bytes or str")
    if len(preimage) > MAX_CACHE_KEY_PREIMAGE_BYTES:
        _fail("HQ_CACHE_KEY_PREIMAGE_TOO_LARGE")
    return preimage


def _mac(secret: bytes, *parts: bytes) -> bytes:
    # Namespace tokens exclude 0x00 by grammar, so joining on it is injective.
    return hmac.new(secret, b"\x00".join(parts), hashlib.sha256).digest()


def _namespace_token(secret: bytes, project: bytes, environment: bytes) -> str:
    digest = _mac(secret, _NAMESPACE_DOMAIN, project, environment)
    return _base64url(digest[:_NAMESPACE_TOKEN_BYTES])


def derive_protocol_cache_namespace_token(
    secret: bytes | None, project: str, environment: str
) -> str:
    """The opaque prefix shared by every key in one namespace.

    Truncated to 16 bytes because it groups keys for prefix operations; it is
    not an authentication tag and never authorises anything.
    """

    key = _require_secret(secret)
    project_bytes, environment_bytes = _require_namespace(project, environment)
    return _namespace_token(key, project_bytes, environment_bytes)


def derive_protocol_cache_key(
    *,
    secret: bytes | None,
    project: str,
    environment: str,
    key_version: int,
    preimage: bytes | str,
) -> str:
    """The opaque store key for one canonical preimage.

    Checks run in the RFC's normative order, so a request that breaks several
    rules reports the same code in every implementation.
    """

    key = _require_secret(secret)
    project_bytes, environment_bytes = _require_namespace(project, environment)
    version = _require_key_version(key_version)
    preimage_bytes = _require_preimage(preimage)

    token = _namespace_token(key, project_bytes, environment_bytes)
    # The namespace is in the entry MAC too, not only in the prefix, so two
    # namespaces cannot collide in a store that ignores prefixes.
    entry = _base64url(_mac(key, _ENTRY_DOMAIN, project_bytes, environment_bytes, preimage_bytes))
    store_key = f"{_SCHEME}.{version}.{token}.{entry}"
    if len(store_key) > MAX_CACHE_STORE_KEY_BYTES:  # pragma: no cover - unreachable in v1
        _fail("HQ_CACHE_KEY_INVALID_VERSION")
    return store_key


__all__ = [
    "MAX_CACHE_KEY_PREIMAGE_BYTES",
    "MAX_CACHE_KEY_VERSION",
    "MAX_CACHE_STORE_KEY_BYTES",
    "MIN_CACHE_KEY_SECRET_BYTES",
    "MIN_CACHE_KEY_VERSION",
    "ProtocolCacheKeyError",
    "ProtocolCacheKeyErrorCode",
    "derive_protocol_cache_key",
    "derive_protocol_cache_namespace_token",
]
