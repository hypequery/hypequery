"""Canonical bytes and identity for an RFC 0006 deployment contract.

The contract is validated before it is encoded, so identity is only ever
computed over something that already passed. The domain prefix keeps a
deployment hash from colliding with any other artifact hashed the same way.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from ._jcs import serialize_jcs
from .deployment_primitives import DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS, ProtocolDeploymentLimits
from .deployments import (
    validate_protocol_deployment_contract,
    validate_protocol_deployment_contract_v3,
)
from .limits import DEFAULT_CANONICAL_VALUE_LIMITS

#: The trailing `\0` is one zero byte, not the two characters.
PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN = "hypequery:deployment:v2\0"
#: Identity domain for deployment contract 3 (RFC 0015).
PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN = "hypequery:deployment:v3\0"


@dataclass(frozen=True, slots=True)
class PreparedProtocolDeploymentContract:
    """A validated contract with its canonical form and identity."""

    contract: dict[str, object]
    canonical: str
    contract_bytes: bytes
    identity: str


def prepare_protocol_deployment_contract(
    value: object,
    *,
    limits: ProtocolDeploymentLimits = DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS,
) -> PreparedProtocolDeploymentContract:
    """Validate a contract, then derive its canonical bytes and identity."""

    contract = validate_protocol_deployment_contract(value, limits=limits)
    return _identify(contract, PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN)


def prepare_protocol_deployment_contract_v3(
    value: object,
    *,
    limits: ProtocolDeploymentLimits = DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS,
) -> PreparedProtocolDeploymentContract:
    """Validate a deployment contract 3, then derive its canonical bytes and identity."""

    contract = validate_protocol_deployment_contract_v3(value, limits=limits)
    return _identify(contract, PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN)


def _identify(contract: dict[str, object], domain: str) -> PreparedProtocolDeploymentContract:
    canonical = serialize_jcs(
        contract, max_bytes=DEFAULT_CANONICAL_VALUE_LIMITS.max_canonical_bytes
    )
    contract_bytes = canonical.encode("utf-8")
    digest = hashlib.sha256()
    digest.update(domain.encode("utf-8"))
    digest.update(contract_bytes)
    return PreparedProtocolDeploymentContract(
        contract=contract,
        canonical=canonical,
        contract_bytes=contract_bytes,
        identity=digest.hexdigest(),
    )


def encode_protocol_deployment_contract(
    value: object,
    *,
    limits: ProtocolDeploymentLimits = DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS,
) -> bytes:
    """Return the canonical UTF-8 bytes of a validated deployment contract."""

    return prepare_protocol_deployment_contract(value, limits=limits).contract_bytes


def encode_protocol_deployment_contract_to_string(
    value: object,
    *,
    limits: ProtocolDeploymentLimits = DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS,
) -> str:
    """Return the canonical JSON text of a validated deployment contract."""

    return prepare_protocol_deployment_contract(value, limits=limits).canonical


def hash_protocol_deployment_contract(
    value: object,
    *,
    limits: ProtocolDeploymentLimits = DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS,
) -> str:
    """Return the lowercase hex SHA-256 deployment identity."""

    return prepare_protocol_deployment_contract(value, limits=limits).identity
