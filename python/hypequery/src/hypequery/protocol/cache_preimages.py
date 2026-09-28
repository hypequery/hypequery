"""RFC 0009 tenant fingerprints and cache preimages.

The preimage is the canonical description of a cached semantic result: the
normalized query plus the only facts outside it that change rows. It stays in
memory and reaches a store only as an RFC 0013 key.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from collections.abc import Mapping, Sequence
from typing import Final, Literal, NoReturn, TypeAlias

from ._jcs import serialize_jcs
from .cache_keys import MAX_CACHE_KEY_PREIMAGE_BYTES, MIN_CACHE_KEY_SECRET_BYTES
from .errors import ProtocolExpressionError
from .expression_models import semantic_query_to_data
from .expressions import validate_protocol_semantic_query
from .utf8 import encode_utf8

ProtocolCachePreimageErrorCode: TypeAlias = Literal[
    "HQ_CACHE_PREIMAGE_SECRET_MISSING",
    "HQ_CACHE_PREIMAGE_SECRET_TOO_SHORT",
    "HQ_CACHE_PREIMAGE_INVALID_DEFINITION",
    "HQ_CACHE_PREIMAGE_INVALID_QUERY",
    "HQ_CACHE_PREIMAGE_INVALID_TENANT",
    "HQ_CACHE_PREIMAGE_INVALID_LIMIT",
]

_FINGERPRINT_DOMAIN: Final = b"hypequery.tenant.fingerprint.v1"
_DEFINITION_IDENTITY: Final = re.compile(r"[0-9a-f]{64}\Z")
_MAX_SAFE_INTEGER: Final = 2**53 - 1


class ProtocolCachePreimageError(ValueError):
    """A stable RFC 0009 cache preimage failure.

    The message is the code only: the secret, tenant identifiers, and filter
    values are all in scope wherever this is raised.
    """

    code: ProtocolCachePreimageErrorCode

    def __init__(self, code: ProtocolCachePreimageErrorCode) -> None:
        super().__init__(code)
        self.code = code


def _fail(code: ProtocolCachePreimageErrorCode) -> NoReturn:
    raise ProtocolCachePreimageError(code)


def _require_secret(secret: bytes | None) -> bytes:
    if secret is None or len(secret) == 0:
        _fail("HQ_CACHE_PREIMAGE_SECRET_MISSING")
    if type(secret) is not bytes:
        raise TypeError("a cache secret must be bytes")
    if len(secret) < MIN_CACHE_KEY_SECRET_BYTES:
        _fail("HQ_CACHE_PREIMAGE_SECRET_TOO_SHORT")
    return secret


def _fingerprint(secret: bytes, tenant_id: object) -> str:
    if type(tenant_id) is not str or not tenant_id:
        _fail("HQ_CACHE_PREIMAGE_INVALID_TENANT")
    message = _FINGERPRINT_DOMAIN + b"\x00" + encode_utf8(tenant_id)
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def derive_protocol_tenant_fingerprint(secret: bytes | None, tenant_id: str) -> str:
    """Tell two tenants apart without revealing either.

    Keyed, because tenant identifier spaces are small enough that an unkeyed
    digest could be reversed by enumeration.
    """

    return _fingerprint(_require_secret(secret), tenant_id)


def _jcs(value: object) -> str:
    return serialize_jcs(value, max_bytes=MAX_CACHE_KEY_PREIMAGE_BYTES)


def _normalize_query(source: object) -> dict[str, object]:
    try:
        validated = validate_protocol_semantic_query(source, extension=2)
    except ProtocolExpressionError:
        # The expression code is not surfaced, so this family's set stays closed.
        _fail("HQ_CACHE_PREIMAGE_INVALID_QUERY")
    query = semantic_query_to_data(validated)
    # AND-combined, so order cannot change rows; identical filters collapse.
    filters = {_jcs(item): item for item in _list(query.get("filters"))}
    normalized: dict[str, object] = {
        "kind": query["kind"],
        "dataset": query["dataset"],
        "dimensions": _list(query.get("dimensions")),
        "filters": [filters[key] for key in sorted(filters, key=encode_utf8)],
        "segments": sorted((str(item) for item in _list(query.get("segments"))), key=encode_utf8),
        "orderBy": _list(query.get("orderBy")),
        "by": query.get("by"),
        "offset": query.get("offset") or None,
    }
    if query["kind"] == "metric":
        normalized["metric"] = query["metric"]
    else:
        # Absent selects every measure and [] selects none, so they stay distinct.
        normalized["measures"] = query.get("measures")
    return normalized


def _list(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def _normalize_tenant(tenant: object, secret: bytes) -> dict[str, object]:
    if not isinstance(tenant, Mapping):
        _fail("HQ_CACHE_PREIMAGE_INVALID_TENANT")
    mode = tenant.get("mode")
    fields = set(tenant)
    if mode in ("none", "all") and fields == {"mode"}:
        return {"mode": mode}
    if mode != "scoped" or fields != {"mode", "ids"}:
        _fail("HQ_CACHE_PREIMAGE_INVALID_TENANT")
    ids = tenant["ids"]
    if isinstance(ids, str) or not isinstance(ids, Sequence) or len(ids) == 0:
        _fail("HQ_CACHE_PREIMAGE_INVALID_TENANT")
    return {"mode": "scoped", "fingerprints": sorted({_fingerprint(secret, i) for i in ids})}


def _normalize_row_limit(row_limit: object) -> int | None:
    if row_limit is None:
        return None
    if type(row_limit) is not int or not 0 <= row_limit <= _MAX_SAFE_INTEGER:
        _fail("HQ_CACHE_PREIMAGE_INVALID_LIMIT")
    return row_limit


def build_protocol_cache_preimage(
    *,
    secret: bytes | None,
    definition_identity: str,
    query: object,
    tenant: Mapping[str, object],
    row_limit: int | None,
) -> str:
    """The canonical preimage identifying one cached semantic result.

    *tenant* is ``{"mode": "none"}``, ``{"mode": "scoped", "ids": [...]}``, or
    ``{"mode": "all"}``, resolved server-side and never from request data.
    Pass the result to `derive_protocol_cache_key`. Never log it, emit it, or
    use it as a key. Checks run in the RFC's normative order.
    """

    key = _require_secret(secret)
    if type(definition_identity) is not str or not _DEFINITION_IDENTITY.match(definition_identity):
        _fail("HQ_CACHE_PREIMAGE_INVALID_DEFINITION")
    return _jcs(
        {
            "kind": "hypequery-cache-preimage",
            "version": 1,
            "definition": definition_identity,
            "query": _normalize_query(query),
            "tenant": _normalize_tenant(tenant, key),
            "rowLimit": _normalize_row_limit(row_limit),
        }
    )


__all__ = [
    "ProtocolCachePreimageError",
    "ProtocolCachePreimageErrorCode",
    "build_protocol_cache_preimage",
    "derive_protocol_tenant_fingerprint",
]
