"""Portable descriptors for the Python, React and MCP client surface."""

from .decode import decode_protocol_client_contract
from .errors import (
    CLIENT_ERROR_MESSAGES,
    ProtocolClientContractError,
    ProtocolClientContractErrorCode,
)
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
from .validate import prepare_protocol_client_contract, validate_protocol_client_contract

__all__ = [
    "CLIENT_ERROR_MESSAGES",
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
    "decode_protocol_client_contract",
    "prepare_protocol_client_contract",
    "validate_protocol_client_contract",
    "validate_protocol_client_query",
]
