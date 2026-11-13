"""`mint_agent_token()`: managed-key agent tokens (AG-18a), signed locally.

Mirrors `packages/agent/src/mint` rule for rule and byte for byte: the same
options mint the same token, and the same bad options are refused, naming the
same option. `specs/agent-token/fixtures/mint-v1` pins both.
"""

from __future__ import annotations

import base64
import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal, TypeAlias, TypeGuard

if TYPE_CHECKING:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

#: The longest lifetime (`exp` - `iat`) Cloud accepts: 15 minutes.
AGENT_TOKEN_MAX_LIFETIME_SECONDS = 15 * 60
_MAX_CONSTRAINTS = 8
_MAX_CONSTRAINT_VALUES = 100
_MAX_SAFE_INTEGER = 2**53 - 1

_KID = re.compile(r"hqsk_[A-Za-z0-9_-]{22}")
_KEY_BYTES = re.compile(r"[A-Za-z0-9_-]{43}")
#: A protocol target token: the project's protocol name, at most 128 bytes.
_PROJECT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
_SUBJECT = re.compile(r"[\x21-\x7e]{1,128}")
_TENANT = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_PERMISSION_SET = re.compile(r"[a-z][a-z0-9-]{0,63}")
_FILTER = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")
_ENDPOINT = re.compile(r"(https?)://([A-Za-z0-9.-]+|\[::1\])(?::([0-9]{1,5}))?(/|/mcp)?")
_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
_DEFAULT_PORTS = {"https": 443, "http": 80}

AgentTokenField: TypeAlias = Literal[
    "signing_key",
    "project",
    "tenant",
    "subject",
    "permission_set",
    "constraints",
    "expires_in_seconds",
    "endpoint",
    "now",
]
ConstraintScalar: TypeAlias = str | int | bool


class AgentTokenError(ValueError):
    """An option the tenant endpoint would refuse; nothing was minted.

    `field` names the option. The message never contains key material.
    """

    def __init__(self, field: AgentTokenField, message: str) -> None:
        super().__init__(message)
        self.field: AgentTokenField = field


@dataclass(frozen=True, slots=True)
class AgentToken:
    """A minted token, the endpoint it is for, and when it stops working."""

    #: A compact JWS: send it as `Authorization: Bearer <token>`. Kept out of
    #: `repr()`, so logging the result doesn't leak a bearer credential.
    token: str = field(repr=False)
    #: The project's tenant MCP endpoint.
    mcp_url: str
    #: Mint a new token before this.
    expires_at: datetime


def agent_token_audience(project: str) -> str:
    """Cloud's audience for a project's managed-key tokens (AG-18a)."""

    return f"hypequery-agent:{_check_project(project)}"


def _check_project(value: object) -> str:
    if not isinstance(value, str) or not _PROJECT.fullmatch(value):
        raise AgentTokenError(
            "project",
            "project must be the project's protocol name as Cloud shows it "
            '(for example "acme:logistics").',
        )
    return value


def _check_subject(value: object) -> str:
    if not isinstance(value, str) or not _SUBJECT.fullmatch(value):
        raise AgentTokenError(
            "subject", "subject must be 1 to 128 printable ASCII characters, without spaces."
        )
    return value


def _check_tenant(value: object) -> str:
    if not isinstance(value, str) or not _TENANT.fullmatch(value):
        raise AgentTokenError(
            "tenant",
            'tenant must be 1 to 128 characters of letters, digits, ".", "_", ":" or "-".',
        )
    return value


def _check_permission_set(value: object) -> str:
    if not isinstance(value, str) or not _PERMISSION_SET.fullmatch(value):
        raise AgentTokenError(
            "permission_set",
            "permission_set must name one of the project's permission sets "
            '(lowercase letters, digits and "-").',
        )
    return value


def _check_lifetime(value: object) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= AGENT_TOKEN_MAX_LIFETIME_SECONDS
    ):
        raise AgentTokenError(
            "expires_in_seconds",
            "expires_in_seconds must be a whole number of seconds from 1 to "
            f"{AGENT_TOKEN_MAX_LIFETIME_SECONDS}.",
        )
    return value


def _utf16_length(value: str) -> int:
    """String length as TypeScript counts it, so both bound strings alike."""

    return len(value.encode("utf-16-le", "surrogatepass")) // 2


def _scalar(value: object, where: str) -> ConstraintScalar:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        if abs(value) <= _MAX_SAFE_INTEGER:
            return value
        raise AgentTokenError(
            "constraints", f"{where} must be a safe integer, a string or a boolean."
        )
    if isinstance(value, str) and 1 <= _utf16_length(value) <= 256:
        try:
            # A surrogate code point has no UTF-8 form, so it can't be signed.
            value.encode("utf-8")
        except UnicodeEncodeError:
            pass
        else:
            return value
    # Floats are refused even when whole: 3.0 would serialize as "3.0", not "3".
    raise AgentTokenError(
        "constraints",
        f"{where} must be a string of 1 to 256 characters, a safe integer or a boolean.",
    )


def _is_list(value: object) -> TypeGuard[Sequence[object]]:
    return isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray)


def _check_constraint(entry: object, where: str, filters: set[str]) -> dict[str, Any]:
    if not isinstance(entry, Mapping):
        raise AgentTokenError("constraints", f"{where} must be an object.")
    for key in entry:
        if key not in ("filter", "operator", "value"):
            raise AgentTokenError("constraints", f'{where} has an unknown member "{key}".')
    filter_name = entry.get("filter")
    operator = entry.get("operator")
    if not isinstance(filter_name, str) or not _FILTER.fullmatch(filter_name):
        raise AgentTokenError("constraints", f"{where}.filter must name a dataset filter.")
    if filter_name in filters:
        raise AgentTokenError(
            "constraints", f'Each filter may be constrained once ("{filter_name}").'
        )
    filters.add(filter_name)
    if operator == "eq":
        return {
            "filter": filter_name,
            "operator": "eq",
            "value": _scalar(entry.get("value"), f"{where}.value"),
        }
    if operator == "in":
        values = entry.get("value")
        if not _is_list(values) or not 1 <= len(values) <= _MAX_CONSTRAINT_VALUES:
            raise AgentTokenError(
                "constraints",
                f"{where}.value must be a list of 1 to {_MAX_CONSTRAINT_VALUES} values.",
            )
        return {
            "filter": filter_name,
            "operator": "in",
            "value": [
                _scalar(item, f"{where}.value[{position}]") for position, item in enumerate(values)
            ],
        }
    raise AgentTokenError("constraints", f'{where}.operator must be "eq" or "in".')


def _check_constraints(value: object) -> list[dict[str, Any]]:
    if not _is_list(value):
        raise AgentTokenError("constraints", "constraints must be a list.")
    if len(value) > _MAX_CONSTRAINTS:
        raise AgentTokenError(
            "constraints", f"A token can carry at most {_MAX_CONSTRAINTS} constraints."
        )
    filters: set[str] = set()
    return [
        _check_constraint(entry, f"constraints[{index}]", filters)
        for index, entry in enumerate(value)
    ]


def _resolve_mcp_url(endpoint: object) -> str:
    """The tenant MCP URL from the project's customer endpoint (TypeScript's
    `resolveMcpUrl`): its origin or its `/mcp` URL, parsed by the same pattern."""

    if not isinstance(endpoint, str):
        raise AgentTokenError(
            "endpoint", "endpoint must be the project's customer endpoint URL from Cloud."
        )
    match = _ENDPOINT.fullmatch(endpoint)
    if match is None:
        raise AgentTokenError(
            "endpoint",
            "endpoint must be the project's customer endpoint, for example "
            '"https://acme-logistics-1f2e3d.hypequery.app", or its "/mcp" URL.',
        )
    scheme, raw_host, port = match.group(1), match.group(2), match.group(3)
    host = raw_host.lower()
    valid_host = host == "[::1]" or (
        len(host) <= 253 and all(_LABEL.fullmatch(label) for label in host.split("."))
    )
    if not valid_host:
        raise AgentTokenError("endpoint", "endpoint has an invalid host name.")
    loopback = host in ("localhost", "127.0.0.1", "[::1]") or host.endswith(".localhost")
    if scheme == "http" and not loopback:
        raise AgentTokenError(
            "endpoint", "endpoint must use https (plain http is allowed for localhost only)."
        )
    authority = host
    if port is not None:
        number = int(port)
        if not 1 <= number <= 65_535:
            raise AgentTokenError("endpoint", "endpoint has an invalid port.")
        if number != _DEFAULT_PORTS[scheme]:
            authority = f"{host}:{number}"
    return f"{scheme}://{authority}/mcp"


def _refuse_key(message: str) -> AgentTokenError:
    return AgentTokenError("signing_key", message)


def _parse_signing_key(signing_key: object) -> tuple[str, str, str]:
    """The key's `kid`, `x` and `d`, from the JSON Cloud shows or its parsed form."""

    value: object = signing_key
    if isinstance(signing_key, str):
        try:
            value = json.loads(signing_key.strip())
        except ValueError:
            raise _refuse_key(
                "The signing key is not valid JSON. Use the private key exactly as Cloud showed it."
            ) from None
    if not isinstance(value, Mapping):
        raise _refuse_key(
            "The signing key must be the private key JSON Cloud showed when it was created."
        )
    if value.get("kty") != "OKP" or value.get("crv") != "Ed25519":
        raise _refuse_key('The signing key must be an Ed25519 key (kty "OKP", crv "Ed25519").')
    if "alg" in value and value["alg"] != "EdDSA":
        raise _refuse_key('The signing key\'s alg must be "EdDSA".')
    if "use" in value and value["use"] != "sig":
        raise _refuse_key('The signing key\'s use must be "sig".')
    kid, x, d = value.get("kid"), value.get("x"), value.get("d")
    if not isinstance(kid, str) or not _KID.fullmatch(kid):
        raise _refuse_key('The signing key has no hypequery key id (kid "hqsk_…").')
    if not isinstance(d, str) or not _KEY_BYTES.fullmatch(d):
        raise _refuse_key(
            "The signing key has no private key (d). Use the private key, not the public one."
        )
    if not isinstance(x, str) or not _KEY_BYTES.fullmatch(x):
        raise _refuse_key("The signing key has no public key (x).")
    return kid, x, d


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _encode_json(value: object) -> str:
    # JSON.stringify's bytes: no spaces, non-ASCII as UTF-8, the same escapes.
    return _b64url(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def _private_key(x: str, d: str) -> Ed25519PrivateKey:
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "Minting agent tokens requires the 'jwt' extra. "
            'Install it with: pip install "hypequery[jwt]"'
        ) from exc
    key = Ed25519PrivateKey.from_private_bytes(_b64url_decode(d))
    public = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    # Cloud verifies with `x`: a key whose `x` isn't `d`'s would mint tokens it refuses.
    if _b64url(public) != x:
        raise _refuse_key("The signing key's public key (x) does not match its private key (d).")
    return key


def mint_agent_token(
    *,
    signing_key: str | Mapping[str, Any],
    project: str,
    endpoint: str,
    tenant: str,
    subject: str,
    permission_set: str,
    constraints: Sequence[Mapping[str, Any]] | None = None,
    expires_in_seconds: int = AGENT_TOKEN_MAX_LIFETIME_SECONDS,
    now: datetime | None = None,
) -> AgentToken:
    """Mint an end-user token for a project's tenant MCP endpoint, locally.

    Signs with a managed signing key (AG-18a, decision 0019 §15) and makes no
    network call, so it is cheap to call per session or per request.

    Args:
        signing_key: The private key JSON Cloud showed once (keep it in
            ``HYPEQUERY_AGENT_KEY``), or that JSON parsed.
        project: The project's protocol name (for example ``"acme:logistics"``).
        endpoint: The project's customer endpoint,
            ``https://<endpoint>.hypequery.app``, or its ``/mcp`` URL.
        tenant: The end user's customer; every query is scoped to it.
        subject: The end user, as your app identifies them.
        permission_set: The permission set the end user acts with, by name.
        constraints: Filters every query carries: ``{"filter", "operator":
            "eq", "value"}`` or ``{"filter", "operator": "in", "value": [...]}``.
        expires_in_seconds: Lifetime, 1 to 900 (Cloud's 15-minute ceiling).
        now: The issue time, timezone-aware; defaults to now.

    Raises:
        AgentTokenError: An option Cloud would refuse.
        ModuleNotFoundError: The ``jwt`` extra is not installed.
    """

    kid, x, d = _parse_signing_key(signing_key)
    audience = agent_token_audience(project)
    mcp_url = _resolve_mcp_url(endpoint)
    checked_subject = _check_subject(subject)
    checked_tenant = _check_tenant(tenant)
    checked_permission_set = _check_permission_set(permission_set)
    checked_constraints = [] if constraints is None else _check_constraints(constraints)
    lifetime = _check_lifetime(expires_in_seconds)
    if now is None:
        now = datetime.now(UTC)
    elif not isinstance(now, datetime) or now.utcoffset() is None:
        raise AgentTokenError("now", "now must be a timezone-aware datetime.")
    issued_at = math.floor(now.timestamp())
    expires_at = issued_at + lifetime

    # Fixed member order, so both languages serialize the same bytes.
    header = {"alg": "EdDSA", "kid": kid, "typ": "JWT"}
    payload: dict[str, Any] = {
        "aud": audience,
        "sub": checked_subject,
        "tenant": checked_tenant,
        "permission_set": checked_permission_set,
    }
    if checked_constraints:
        payload["constraints"] = checked_constraints
    payload["iat"] = issued_at
    payload["exp"] = expires_at
    signing_input = f"{_encode_json(header)}.{_encode_json(payload)}"
    signature = _private_key(x, d).sign(signing_input.encode("ascii"))
    return AgentToken(
        token=f"{signing_input}.{_b64url(signature)}",
        mcp_url=mcp_url,
        expires_at=datetime.fromtimestamp(expires_at, UTC),
    )
