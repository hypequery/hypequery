"""Cloud's managed-key verifier (AG-18a), ported for tests.

hypequery-cloud `apps/web/src/lib/signing-keys/verify.ts`
(`verifySigningKeyJwt`, on jose) and the claim rules of `readCustomerClaims`
with the fixed managed-key mapping. A minted token must pass this exactly as
it passes the tenant `/mcp`. `packages/agent/test/ag18a-verifier.ts` ports the
same rules for TypeScript; keep both in step with Cloud.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from hypequery.agent.mint import _b64url_decode

MAX_LIFETIME_SECONDS = 15 * 60
CLOCK_TOLERANCE_SECONDS = 30
_KID = re.compile(r"hqsk_[A-Za-z0-9_-]{22}")
_PUBLIC_KEY = re.compile(r"[A-Za-z0-9_-]{43}")
_SUBJECT = re.compile(r"[\x21-\x7e]{1,128}")
_TENANT = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_PERMISSION_SET = re.compile(r"[a-z][a-z0-9-]{0,63}")
_FILTER = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")


def signing_key_audience(protocol_name: str) -> str:
    return f"hypequery-agent:{protocol_name}"


def _scalar(value: object) -> bool:
    if isinstance(value, bool):
        return True
    if isinstance(value, int):
        return abs(value) <= 2**53 - 1
    return isinstance(value, str) and 1 <= len(value.encode("utf-16-le")) // 2 <= 256


def _constraints(value: object) -> bool:
    """`embedConstraintsSchema`: at most 8 strict `eq`/`in` constraints, one per filter."""

    if not isinstance(value, list) or len(value) > 8:
        return False
    filters: set[str] = set()
    for entry in value:
        if not isinstance(entry, dict) or set(entry) != {"filter", "operator", "value"}:
            return False
        name, operator, operand = entry["filter"], entry["operator"], entry["value"]
        if not isinstance(name, str) or not _FILTER.fullmatch(name):
            return False
        if operator == "eq":
            if not _scalar(operand):
                return False
        elif operator == "in":
            if not isinstance(operand, list) or not 1 <= len(operand) <= 100:
                return False
            if not all(_scalar(item) for item in operand):
                return False
        else:
            return False
        filters.add(name)
    return len(filters) == len(value)


def verify_signing_key_jwt(
    token: str, key: Mapping[str, str], audience: str, now: float
) -> dict[str, Any] | None:
    """The end user a token names, or None for any token Cloud would refuse."""

    if not _KID.fullmatch(key["kid"]) or not _PUBLIC_KEY.fullmatch(key["publicKey"]):
        return None
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        return None
    # jose: only EdDSA/Ed25519, and the key the header's kid names.
    if header.get("alg") not in ("EdDSA", "Ed25519") or header.get("kid") != key["kid"]:
        return None
    public_key = Ed25519PublicKey.from_public_bytes(_b64url_decode(key["publicKey"]))
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            public_key,
            algorithms=["EdDSA"],
            audience=audience,
            leeway=CLOCK_TOLERANCE_SECONDS,
            options={"require": ["sub", "iat", "exp"], "verify_iat": False, "verify_exp": False},
        )
    except jwt.PyJWTError:
        return None
    issued_at, expires_at = payload.get("iat"), payload.get("exp")
    if not isinstance(issued_at, int) or not isinstance(expires_at, int):
        return None
    # jose's exp check and maxTokenAge, both with the clock tolerance.
    if expires_at <= now - CLOCK_TOLERANCE_SECONDS:
        return None
    if now - issued_at - CLOCK_TOLERANCE_SECONDS > MAX_LIFETIME_SECONDS:
        return None
    if issued_at > int(now) + CLOCK_TOLERANCE_SECONDS:
        return None
    if expires_at - issued_at > MAX_LIFETIME_SECONDS:
        return None

    subject, tenant = payload.get("sub"), payload.get("tenant")
    permission_set = payload.get("permission_set")
    if not isinstance(subject, str) or not _SUBJECT.fullmatch(subject):
        return None
    if not isinstance(tenant, str) or not _TENANT.fullmatch(tenant):
        return None
    if not isinstance(permission_set, str) or not _PERMISSION_SET.fullmatch(permission_set):
        return None
    constraints = payload.get("constraints", [])
    if "constraints" in payload and not _constraints(constraints):
        return None
    return {
        "subject": subject,
        "tenantId": tenant,
        "permissionSetName": permission_set,
        "constraints": constraints,
    }
