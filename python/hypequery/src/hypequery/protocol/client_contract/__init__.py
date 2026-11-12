"""Portable descriptors for the Python, React and MCP client surface."""

from .decode import decode_protocol_client_contract
from .errors import (
    CLIENT_ERROR_MESSAGES,
    ProtocolClientContractError,
    ProtocolClientContractErrorCode,
)
from .features import (
    CLIENT_CONTRACT_FEATURES,
    CLIENT_CONTRACT_FEATURES_HEADER,
    CLIENT_CONTRACT_FIELD_METADATA_FEATURE,
    accepts_client_field_metadata,
    parse_client_contract_features,
)
from .field_metadata import without_client_field_metadata
from .models import (
    ClientDimension,
    ClientEndpointAnnotations,
    ClientFieldAnnotation,
    ClientFilter,
    ClientMeasure,
    ClientQueryLimits,
    ClientQueryPlan,
    ClientTime,
    PreparedProtocolClientContract,
    ProtocolClientContract,
    ProtocolClientEndpoint,
)
from .query import validate_protocol_client_query
from .tool_schemas import ClientContractToolSchemas, build_client_contract_tool_schemas
from .validate import prepare_protocol_client_contract, validate_protocol_client_contract

__all__ = [
    "CLIENT_CONTRACT_FEATURES",
    "CLIENT_CONTRACT_FEATURES_HEADER",
    "CLIENT_CONTRACT_FIELD_METADATA_FEATURE",
    "CLIENT_ERROR_MESSAGES",
    "ClientContractToolSchemas",
    "ClientDimension",
    "ClientEndpointAnnotations",
    "ClientFieldAnnotation",
    "ClientFilter",
    "ClientMeasure",
    "ClientQueryLimits",
    "ClientQueryPlan",
    "ClientTime",
    "PreparedProtocolClientContract",
    "ProtocolClientContract",
    "ProtocolClientContractError",
    "ProtocolClientContractErrorCode",
    "ProtocolClientEndpoint",
    "accepts_client_field_metadata",
    "build_client_contract_tool_schemas",
    "decode_protocol_client_contract",
    "parse_client_contract_features",
    "prepare_protocol_client_contract",
    "validate_protocol_client_contract",
    "validate_protocol_client_query",
    "without_client_field_metadata",
]
