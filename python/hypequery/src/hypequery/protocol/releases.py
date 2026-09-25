"""Strict RFC 0008 deployment release envelope validation and identity.

A release is the deterministic request that assigns one verified RFC 0007
bundle to a project and environment. It carries no credentials, account
identity, timestamps, mutable status, endpoint, or executable bytes — those
belong to authenticated transport and the control plane.

Timestamps and requester identity are excluded deliberately: including them
would make a retry of an unchanged envelope produce a different identity, and
the identity is what makes the request safe to retry.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, fields
from typing import cast

from ._jcs import serialize_jcs
from .errors import release_error
from .limits import DEFAULT_CANONICAL_VALUE_LIMITS
from .utf8 import exceeds_utf8_byte_limit

#: The trailing `\0` is one zero byte, not the two characters.
PROTOCOL_DEPLOYMENT_RELEASE_IDENTITY_DOMAIN = "hypequery:deployment-release:v1\0"

_SHA256 = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
_TARGET_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]*\Z", re.ASCII)
_RELEASE_MAXIMUMS = {"max_target_bytes": 128}


@dataclass(frozen=True, slots=True)
class ProtocolDeploymentReleaseLimits:
    """Product limits that may lower, but never raise, RFC 0008 limits."""

    max_target_bytes: int = _RELEASE_MAXIMUMS["max_target_bytes"]

    def __post_init__(self) -> None:
        for limit in fields(self):
            value = getattr(self, limit.name)
            maximum = _RELEASE_MAXIMUMS[limit.name]
            if type(value) is not int or value < 1 or value > maximum:
                msg = (
                    f"{limit.name} must be a positive integer no greater than "
                    "the deployment release maximum"
                )
                raise ValueError(msg)


DEFAULT_PROTOCOL_DEPLOYMENT_RELEASE_LIMITS = ProtocolDeploymentReleaseLimits()


@dataclass(frozen=True, slots=True)
class PreparedProtocolDeploymentRelease:
    """A validated release with its canonical form and identity."""

    envelope: dict[str, object]
    canonical: str
    envelope_bytes: bytes
    identity: str


def _record(value: object, path: str) -> dict[str, object]:
    if type(value) is dict:
        return cast(dict[str, object], value)
    if value is None or type(value) in (bool, str, int, float, list):
        release_error("HQ_RELEASE_TYPE", path)
    release_error("HQ_RELEASE_UNSAFE_OBJECT", path)


def _exact_fields(value: dict[str, object], required: tuple[str, ...], path: str) -> None:
    allowed = frozenset(required)
    for key in value:
        if type(key) is not str:
            release_error("HQ_RELEASE_UNSAFE_OBJECT", path)
        if key not in allowed:
            release_error("HQ_RELEASE_UNKNOWN_FIELD", f"{path}.{key}")
    for key in required:
        if key not in value:
            release_error("HQ_RELEASE_TYPE", f"{path}.{key}")


def _target_token(value: object, path: str, maximum: int) -> str:
    """A case-sensitive opaque routing identifier, not authorization evidence."""

    if type(value) is not str:
        release_error("HQ_RELEASE_TYPE", path)
    if len(value) > maximum or exceeds_utf8_byte_limit(value, maximum):
        release_error("HQ_RELEASE_TOO_LARGE", path)
    if _TARGET_TOKEN.match(value) is None:
        release_error("HQ_RELEASE_INVALID_VALUE", path)
    return value


def _target(value: object, maximum: int) -> dict[str, object]:
    node = _record(value, "$.target")
    _exact_fields(node, ("project", "environment"), "$.target")
    return {
        "project": _target_token(node["project"], "$.target.project", maximum),
        "environment": _target_token(node["environment"], "$.target.environment", maximum),
    }


def validate_protocol_deployment_release_target(
    value: object,
    *,
    limits: ProtocolDeploymentReleaseLimits = DEFAULT_PROTOCOL_DEPLOYMENT_RELEASE_LIMITS,
) -> dict[str, object]:
    """Validate a release target on its own."""

    return _target(value, limits.max_target_bytes)


def validate_protocol_deployment_release_envelope(
    value: object,
    *,
    limits: ProtocolDeploymentReleaseLimits = DEFAULT_PROTOCOL_DEPLOYMENT_RELEASE_LIMITS,
) -> dict[str, object]:
    """Validate a release envelope and return it as detached protocol data."""

    node = _record(value, "$")
    _exact_fields(node, ("kind", "version", "bundleIdentity", "target"), "$")
    if node["kind"] != "hypequery-deployment-release":
        if type(node["kind"]) is not str:
            release_error("HQ_RELEASE_TYPE", "$.kind")
        release_error("HQ_RELEASE_INVALID_VALUE", "$.kind")
    version = node["version"]
    if type(version) is bool or version != 1:
        if type(version) is bool or type(version) not in (int, float):
            release_error("HQ_RELEASE_TYPE", "$.version")
        release_error("HQ_RELEASE_INVALID_VERSION", "$.version")
    identity = node["bundleIdentity"]
    if type(identity) is not str:
        release_error("HQ_RELEASE_TYPE", "$.bundleIdentity")
    if _SHA256.match(identity) is None:
        release_error("HQ_RELEASE_INVALID_VALUE", "$.bundleIdentity")
    return {
        "kind": "hypequery-deployment-release",
        "version": 1,
        "bundleIdentity": identity,
        "target": _target(node["target"], limits.max_target_bytes),
    }


def prepare_protocol_deployment_release_envelope(
    value: object,
    *,
    limits: ProtocolDeploymentReleaseLimits = DEFAULT_PROTOCOL_DEPLOYMENT_RELEASE_LIMITS,
) -> PreparedProtocolDeploymentRelease:
    """Validate a release, then derive its canonical bytes and identity."""

    envelope = validate_protocol_deployment_release_envelope(value, limits=limits)
    canonical = serialize_jcs(
        envelope, max_bytes=DEFAULT_CANONICAL_VALUE_LIMITS.max_canonical_bytes
    )
    envelope_bytes = canonical.encode("utf-8")
    digest = hashlib.sha256()
    digest.update(PROTOCOL_DEPLOYMENT_RELEASE_IDENTITY_DOMAIN.encode("utf-8"))
    digest.update(envelope_bytes)
    return PreparedProtocolDeploymentRelease(
        envelope=envelope,
        canonical=canonical,
        envelope_bytes=envelope_bytes,
        identity=digest.hexdigest(),
    )


def encode_protocol_deployment_release_envelope(
    value: object,
    *,
    limits: ProtocolDeploymentReleaseLimits = DEFAULT_PROTOCOL_DEPLOYMENT_RELEASE_LIMITS,
) -> bytes:
    """Return the canonical UTF-8 bytes of a validated release envelope."""

    return prepare_protocol_deployment_release_envelope(value, limits=limits).envelope_bytes


def encode_protocol_deployment_release_envelope_to_string(
    value: object,
    *,
    limits: ProtocolDeploymentReleaseLimits = DEFAULT_PROTOCOL_DEPLOYMENT_RELEASE_LIMITS,
) -> str:
    """Return the canonical JSON text of a validated release envelope."""

    return prepare_protocol_deployment_release_envelope(value, limits=limits).canonical


def hash_protocol_deployment_release_envelope(
    value: object,
    *,
    limits: ProtocolDeploymentReleaseLimits = DEFAULT_PROTOCOL_DEPLOYMENT_RELEASE_LIMITS,
) -> str:
    """Return the lowercase hex SHA-256 release identity."""

    return prepare_protocol_deployment_release_envelope(value, limits=limits).identity
