"""Language-neutral Hypequery security-protocol primitives.

RFC 0001 tagged values and exact RFC 8785 canonical JSON are available now.
Portable identifiers are added by PYA-04.
"""

from __future__ import annotations

from .constructors import (
    TaggedValue,
    array_value,
    bytes_value,
    date_value,
    datetime_value,
    decimal_value,
    enum_value,
    integer_value,
    map_value,
    tuple_value,
    uuid_value,
)
from .errors import ProtocolValueError, ProtocolValueErrorCode
from .limits import DEFAULT_CANONICAL_VALUE_LIMITS, CanonicalValueLimits
from .values import (
    CanonicalValue,
    decode_canonical_value,
    encode_canonical_value,
    encode_canonical_value_to_string,
    hash_canonical_value,
    validate_canonical_value,
)

__all__ = [
    "DEFAULT_CANONICAL_VALUE_LIMITS",
    "CanonicalValue",
    "CanonicalValueLimits",
    "ProtocolValueError",
    "ProtocolValueErrorCode",
    "TaggedValue",
    "array_value",
    "bytes_value",
    "date_value",
    "datetime_value",
    "decimal_value",
    "decode_canonical_value",
    "encode_canonical_value",
    "encode_canonical_value_to_string",
    "enum_value",
    "hash_canonical_value",
    "integer_value",
    "map_value",
    "tuple_value",
    "uuid_value",
    "validate_canonical_value",
]
