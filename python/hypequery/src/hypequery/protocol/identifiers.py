"""RFC 0002 portable logical identifiers.

Parsed values are immutable built-in strings with distinct static brands.
Validation intentionally avoids coercion, normalization, and user-defined
hooks so every accepted value has the same meaning in Python and TypeScript.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import NewType

from .errors import ProtocolIdentifierError, ProtocolIdentifierErrorCode, identifier_error

ProtocolIdentifier = NewType("ProtocolIdentifier", str)
ProtocolQualifiedIdentifier = NewType("ProtocolQualifiedIdentifier", str)


@dataclass(frozen=True, slots=True)
class _ProtocolIdentifierLimits:
    """Frozen limits for identifier extension version 1."""

    max_segment_bytes: int = 128
    max_qualified_bytes: int = 512
    max_segments: int = 8


PROTOCOL_IDENTIFIER_LIMITS = _ProtocolIdentifierLimits()

_IDENTIFIER_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*", re.ASCII)
_RESERVED_PREFIX = "__hypequery"


def _exceeds_utf8_byte_limit(value: str, maximum: int) -> bool:
    """Check a UTF-8 limit using the USV-string semantics of TextEncoder.

    Python can hold unpaired UTF-16 surrogates even though JSON and UTF-8
    cannot. Treating each unpaired surrogate as U+FFFD matches the JavaScript
    reference implementation and keeps validation precedence deterministic.
    The scan stops as soon as the limit is exceeded, bounding work on hostile
    in-memory inputs.
    """

    length = 0
    index = 0
    while index < len(value):
        code_point = ord(value[index])
        if code_point <= 0x7F:
            length += 1
        elif code_point <= 0x7FF:
            length += 2
        elif 0xD800 <= code_point <= 0xDBFF:
            if index + 1 < len(value) and 0xDC00 <= ord(value[index + 1]) <= 0xDFFF:
                length += 4
                index += 1
            else:
                length += 3
        elif 0xDC00 <= code_point <= 0xDFFF:
            length += 3
        elif code_point <= 0xFFFF:
            length += 3
        else:
            length += 4
        if length > maximum:
            return True
        index += 1
    return False


def _parse_segment(
    value: object,
    *,
    empty_code: ProtocolIdentifierErrorCode,
) -> ProtocolIdentifier:
    if type(value) is not str:
        identifier_error("HQ_IDENTIFIER_TYPE")
    text = value
    if not text:
        identifier_error(empty_code)
    if _exceeds_utf8_byte_limit(text, PROTOCOL_IDENTIFIER_LIMITS.max_segment_bytes):
        identifier_error("HQ_IDENTIFIER_TOO_LONG")
    if _IDENTIFIER_PATTERN.fullmatch(text) is None:
        identifier_error("HQ_IDENTIFIER_INVALID_FORMAT")
    # The grammar gate above proves the input is ASCII, making this
    # case-insensitive comparison language-neutral.
    if text[: len(_RESERVED_PREFIX)].lower() == _RESERVED_PREFIX:
        identifier_error("HQ_IDENTIFIER_RESERVED")
    return ProtocolIdentifier(text)


def parse_protocol_identifier(value: object) -> ProtocolIdentifier:
    """Parse one portable, case-sensitive logical identifier segment."""

    return _parse_segment(value, empty_code="HQ_IDENTIFIER_EMPTY")


def parse_protocol_qualified_identifier(value: object) -> ProtocolQualifiedIdentifier:
    """Parse a dot-qualified portable identifier without normalizing it."""

    if type(value) is not str:
        identifier_error("HQ_IDENTIFIER_TYPE")
    text = value
    if not text:
        identifier_error("HQ_IDENTIFIER_EMPTY")
    if _exceeds_utf8_byte_limit(text, PROTOCOL_IDENTIFIER_LIMITS.max_qualified_bytes):
        identifier_error("HQ_IDENTIFIER_TOO_LONG")

    # Count before splitting so an attacker cannot force an unbounded derived
    # allocation. The qualified byte limit bounds the scan itself.
    segment_count = text.count(".") + 1
    if segment_count > PROTOCOL_IDENTIFIER_LIMITS.max_segments:
        identifier_error("HQ_IDENTIFIER_TOO_MANY_SEGMENTS")

    for segment in text.split("."):
        _parse_segment(segment, empty_code="HQ_IDENTIFIER_INVALID_FORMAT")
    return ProtocolQualifiedIdentifier(text)


def split_protocol_qualified_identifier(
    value: ProtocolQualifiedIdentifier,
) -> tuple[ProtocolIdentifier, ...]:
    """Return the validated segments of a qualified identifier."""

    parsed = parse_protocol_qualified_identifier(value)
    return tuple(ProtocolIdentifier(segment) for segment in parsed.split("."))


def join_protocol_qualified_identifier(
    segments: Sequence[object],
) -> ProtocolQualifiedIdentifier:
    """Validate and join one to eight identifier segments."""

    # Exact built-in containers prevent custom iteration or indexing hooks
    # from running inside this security boundary.
    if type(segments) not in (list, tuple):
        identifier_error("HQ_IDENTIFIER_TYPE")
    if len(segments) == 0:
        identifier_error("HQ_IDENTIFIER_EMPTY")
    if len(segments) > PROTOCOL_IDENTIFIER_LIMITS.max_segments:
        identifier_error("HQ_IDENTIFIER_TOO_MANY_SEGMENTS")

    snapshot = tuple(segments)
    parsed = tuple(
        _parse_segment(segment, empty_code="HQ_IDENTIFIER_INVALID_FORMAT") for segment in snapshot
    )
    value = ".".join(parsed)
    if _exceeds_utf8_byte_limit(value, PROTOCOL_IDENTIFIER_LIMITS.max_qualified_bytes):
        identifier_error("HQ_IDENTIFIER_TOO_LONG")
    return ProtocolQualifiedIdentifier(value)


def is_protocol_identifier(value: object) -> bool:
    """Return whether *value* is a valid simple protocol identifier."""

    try:
        parse_protocol_identifier(value)
    except ProtocolIdentifierError:
        return False
    return True


def is_protocol_qualified_identifier(value: object) -> bool:
    """Return whether *value* is a valid qualified protocol identifier."""

    try:
        parse_protocol_qualified_identifier(value)
    except ProtocolIdentifierError:
        return False
    return True
