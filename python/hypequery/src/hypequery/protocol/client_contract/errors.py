"""Safe client-contract failures, shared verbatim with TypeScript."""

from types import MappingProxyType
from typing import Literal, NoReturn, TypeAlias

ProtocolClientContractErrorCode: TypeAlias = Literal[
    "HQ_CLIENT_TYPE",
    "HQ_CLIENT_LIMIT",
    "HQ_CLIENT_VERSION",
    "HQ_CLIENT_UNKNOWN_FIELD",
    "HQ_CLIENT_SHAPE",
    "HQ_CLIENT_IDENTIFIER",
    "HQ_CLIENT_DUPLICATE",
    "HQ_CLIENT_PATH",
    "HQ_CLIENT_REFERENCE",
    "HQ_CLIENT_IDENTITY",
    "HQ_CLIENT_QUERY",
]

CLIENT_ERROR_MESSAGES = MappingProxyType(
    {
        "HQ_CLIENT_TYPE": "Expected plain JSON data.",
        "HQ_CLIENT_LIMIT": "Client contract exceeds validation limits.",
        "HQ_CLIENT_VERSION": "Unsupported client contract version.",
        "HQ_CLIENT_UNKNOWN_FIELD": "Unknown client contract field.",
        "HQ_CLIENT_SHAPE": "Invalid client contract shape.",
        "HQ_CLIENT_IDENTIFIER": "Invalid client contract identifier.",
        "HQ_CLIENT_DUPLICATE": "Duplicate client contract entry.",
        "HQ_CLIENT_PATH": "Invalid client endpoint path.",
        "HQ_CLIENT_REFERENCE": "Inconsistent client contract reference.",
        "HQ_CLIENT_IDENTITY": "Client contract identity does not match.",
        "HQ_CLIENT_QUERY": "Invalid client query.",
    }
)


class ProtocolClientContractError(TypeError):
    """A stable failure code and JSON Pointer; never includes submitted values."""

    def __init__(self, code: ProtocolClientContractErrorCode, path: str = "") -> None:
        self.code = code
        self.path = path
        super().__init__(CLIENT_ERROR_MESSAGES[code])


def client_error(code: ProtocolClientContractErrorCode, path: str = "") -> NoReturn:
    raise ProtocolClientContractError(code, path)
