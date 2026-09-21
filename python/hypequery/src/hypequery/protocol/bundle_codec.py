"""Canonical bytes and identity for an RFC 0007 bundle manifest.

The manifest identity names the set of declared files and their exact bytes.
It does not replace the individual artifact hashes, the RFC 0006 deployment
identity, the RFC 0008 release identity, or a future detached signature.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from ._jcs import serialize_jcs
from .bundles import (
    DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
    ProtocolDeploymentBundleLimits,
    validate_protocol_deployment_bundle_manifest,
)
from .limits import DEFAULT_CANONICAL_VALUE_LIMITS

#: The trailing `\0` is one zero byte, not the two characters.
PROTOCOL_DEPLOYMENT_BUNDLE_IDENTITY_DOMAIN = "hypequery:deployment-bundle:v1\0"


@dataclass(frozen=True, slots=True)
class PreparedProtocolDeploymentBundleManifest:
    """A validated manifest with its canonical form and identity."""

    manifest: dict[str, object]
    canonical: str
    manifest_bytes: bytes
    identity: str


def prepare_protocol_deployment_bundle_manifest(
    value: object,
    *,
    limits: ProtocolDeploymentBundleLimits = DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
) -> PreparedProtocolDeploymentBundleManifest:
    """Validate a manifest, then derive its canonical bytes and identity."""

    manifest = validate_protocol_deployment_bundle_manifest(value, limits=limits)
    canonical = serialize_jcs(
        manifest, max_bytes=DEFAULT_CANONICAL_VALUE_LIMITS.max_canonical_bytes
    )
    manifest_bytes = canonical.encode("utf-8")
    digest = hashlib.sha256()
    digest.update(PROTOCOL_DEPLOYMENT_BUNDLE_IDENTITY_DOMAIN.encode("utf-8"))
    digest.update(manifest_bytes)
    return PreparedProtocolDeploymentBundleManifest(
        manifest=manifest,
        canonical=canonical,
        manifest_bytes=manifest_bytes,
        identity=digest.hexdigest(),
    )


def encode_protocol_deployment_bundle_manifest(
    value: object,
    *,
    limits: ProtocolDeploymentBundleLimits = DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
) -> bytes:
    """Return the canonical UTF-8 bytes of a validated bundle manifest."""

    return prepare_protocol_deployment_bundle_manifest(value, limits=limits).manifest_bytes


def encode_protocol_deployment_bundle_manifest_to_string(
    value: object,
    *,
    limits: ProtocolDeploymentBundleLimits = DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
) -> str:
    """Return the canonical JSON text of a validated bundle manifest."""

    return prepare_protocol_deployment_bundle_manifest(value, limits=limits).canonical


def hash_protocol_deployment_bundle_manifest(
    value: object,
    *,
    limits: ProtocolDeploymentBundleLimits = DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
) -> str:
    """Return the lowercase hex SHA-256 bundle manifest identity."""

    return prepare_protocol_deployment_bundle_manifest(value, limits=limits).identity
