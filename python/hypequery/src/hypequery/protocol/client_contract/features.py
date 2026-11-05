"""Optional client-contract members a consumer opts into per discovery request.

Validators released before a member existed reject it as an unknown field, so a
producer emits it only to a consumer that names its feature in this request
header. Tokens are comma-separated and case-insensitive; unknown tokens are
ignored, and an oversized header names no features.
"""

from __future__ import annotations

CLIENT_CONTRACT_FEATURES_HEADER = "x-hypequery-client-features"
#: Field annotations' synonyms, examples, format, unit and currency (RFC 0018, 2026-11-05).
CLIENT_CONTRACT_FIELD_METADATA_FEATURE = "field-metadata"
#: Every feature this version understands, as one header value.
CLIENT_CONTRACT_FEATURES = CLIENT_CONTRACT_FIELD_METADATA_FEATURE
_MAX_FEATURES_HEADER_LENGTH = 256


def parse_client_contract_features(value: str | None) -> frozenset[str]:
    """The feature tokens named by a features header value (None when absent)."""
    if type(value) is not str or len(value) > _MAX_FEATURES_HEADER_LENGTH:
        return frozenset()
    return frozenset(token for item in value.split(",") if (token := item.strip(" \t").lower()))


def accepts_client_field_metadata(value: str | None) -> bool:
    """Whether a features header value asks for field metadata."""
    return CLIENT_CONTRACT_FIELD_METADATA_FEATURE in parse_client_contract_features(value)
