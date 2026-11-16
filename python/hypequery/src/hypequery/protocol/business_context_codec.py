"""Canonical bytes and identity for a business context v1 document.

The identity is SHA-256 over a domain separator and the RFC 8785 canonical
bytes of the validated document, exactly as `@hypequery/protocol`'s
`prepareProtocolBusinessContext` computes it.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from ._jcs import serialize_jcs
from .business_context import (
    DEFAULT_PROTOCOL_BUSINESS_CONTEXT_LIMITS,
    ProtocolBusinessContext,
    ProtocolBusinessContextLimits,
    validate_protocol_business_context,
)
from .errors import ProtocolValueError, business_context_error

#: The trailing `\0` is one zero byte, not the two characters.
PROTOCOL_BUSINESS_CONTEXT_IDENTITY_DOMAIN = "hypequery:business-context:v1\0"


@dataclass(frozen=True, slots=True)
class PreparedProtocolBusinessContext:
    """A validated business context with its canonical form and identity."""

    context: ProtocolBusinessContext
    canonical: str
    context_bytes: bytes
    identity: str


def prepare_protocol_business_context(
    value: object,
    *,
    limits: ProtocolBusinessContextLimits = DEFAULT_PROTOCOL_BUSINESS_CONTEXT_LIMITS,
) -> PreparedProtocolBusinessContext:
    """Validate a document, then derive its canonical bytes and identity."""

    context = validate_protocol_business_context(value, limits=limits)
    try:
        canonical = serialize_jcs(context, max_bytes=limits.max_bytes)
    except ProtocolValueError as error:
        if error.code != "HQ_VALUE_TOO_LARGE":
            raise
        business_context_error("HQ_BUSINESS_CONTEXT_TOO_LARGE")
    context_bytes = canonical.encode("utf-8")
    digest = hashlib.sha256()
    digest.update(PROTOCOL_BUSINESS_CONTEXT_IDENTITY_DOMAIN.encode("utf-8"))
    digest.update(context_bytes)
    return PreparedProtocolBusinessContext(
        context=context,
        canonical=canonical,
        context_bytes=context_bytes,
        identity=digest.hexdigest(),
    )


def encode_protocol_business_context(
    value: object,
    *,
    limits: ProtocolBusinessContextLimits = DEFAULT_PROTOCOL_BUSINESS_CONTEXT_LIMITS,
) -> bytes:
    """Return the canonical UTF-8 bytes of a validated business context."""

    return prepare_protocol_business_context(value, limits=limits).context_bytes


def encode_protocol_business_context_to_string(
    value: object,
    *,
    limits: ProtocolBusinessContextLimits = DEFAULT_PROTOCOL_BUSINESS_CONTEXT_LIMITS,
) -> str:
    """Return the canonical JSON text of a validated business context."""

    return prepare_protocol_business_context(value, limits=limits).canonical


def hash_protocol_business_context(
    value: object,
    *,
    limits: ProtocolBusinessContextLimits = DEFAULT_PROTOCOL_BUSINESS_CONTEXT_LIMITS,
) -> str:
    """Return the lowercase hex SHA-256 business context identity."""

    return prepare_protocol_business_context(value, limits=limits).identity
