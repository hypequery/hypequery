"""`mint_agent_token()` beyond the shared fixtures: Python-only inputs, the
key as Cloud generates it, no network, and the missing-extra message."""

from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import sys
import textwrap
import time
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import pytest

pytest.importorskip("cryptography")
pytest.importorskip("jwt")

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from agent_verifier import signing_key_audience, verify_signing_key_jwt
from hypequery.agent import (
    AGENT_TOKEN_MAX_LIFETIME_SECONDS,
    AgentToken,
    AgentTokenError,
    agent_token_audience,
    mint_agent_token,
)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def cloud_signing_key() -> dict[str, str]:
    """A key shaped as Cloud's `generateSigningKey()` (AG-18a) shapes it."""

    key = Ed25519PrivateKey.generate()
    return {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": b64url(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)),
        "d": b64url(key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())),
        "kid": "hqsk_" + b64url(os.urandom(16)),
        "alg": "EdDSA",
        "use": "sig",
    }


KEY = cloud_signing_key()
PUBLIC_KEY = {"kid": KEY["kid"], "publicKey": KEY["x"]}
OPTIONS: dict[str, Any] = {
    "signing_key": json.dumps(KEY),
    "project": "acme:logistics",
    "endpoint": "https://acme-logistics-1f2e3d4c.hypequery.app",
    "tenant": "northwind",
    "subject": "user_42",
    "permission_set": "customers",
}
AUDIENCE = signing_key_audience("acme:logistics")


def test_mints_a_token_the_verifier_accepts_now_without_the_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def no_network(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("minting must not open a socket")

    monkeypatch.setattr(socket, "socket", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    before = int(time.time())
    minted = mint_agent_token(**OPTIONS)
    assert minted.mcp_url == "https://acme-logistics-1f2e3d4c.hypequery.app/mcp"
    assert 900 <= minted.expires_at.timestamp() - before <= 901
    assert verify_signing_key_jwt(minted.token, PUBLIC_KEY, AUDIENCE, time.time()) == {
        "subject": "user_42",
        "tenantId": "northwind",
        "permissionSetName": "customers",
        "constraints": [],
    }


def test_takes_the_key_parsed_and_ignores_members_it_does_not_use() -> None:
    now = datetime(2026, 11, 13, 12, tzinfo=UTC)
    from_string = mint_agent_token(**OPTIONS, now=now)
    from_mapping = mint_agent_token(
        **{**OPTIONS, "signing_key": {**KEY, "key_ops": ["sign"]}}, now=now
    )
    assert from_mapping.token == from_string.token


def test_any_timezone_gives_the_same_token() -> None:
    utc = datetime(2026, 11, 13, 12, tzinfo=UTC)
    shifted = utc.astimezone(timezone(timedelta(hours=-5)))
    assert (
        mint_agent_token(**OPTIONS, now=utc).token == mint_agent_token(**OPTIONS, now=shifted).token
    )


def test_constraints_round_trip_through_the_verifier() -> None:
    constraints: list[dict[str, Any]] = [
        {"filter": "region", "operator": "in", "value": ("emea", "apac")},
        {"filter": "carrier_id", "operator": "eq", "value": 7},
    ]
    minted = mint_agent_token(**OPTIONS, constraints=constraints)
    verified = verify_signing_key_jwt(minted.token, PUBLIC_KEY, AUDIENCE, time.time())
    assert verified is not None
    assert verified["constraints"] == [
        {"filter": "region", "operator": "in", "value": ["emea", "apac"]},
        {"filter": "carrier_id", "operator": "eq", "value": 7},
    ]


def test_caps_the_lifetime_at_fifteen_minutes() -> None:
    assert AGENT_TOKEN_MAX_LIFETIME_SECONDS == 900
    now = datetime(2026, 11, 13, 12, tzinfo=UTC)
    assert mint_agent_token(
        **OPTIONS, expires_in_seconds=60, now=now
    ).expires_at == now + timedelta(seconds=60)
    with pytest.raises(AgentTokenError) as raised:
        mint_agent_token(**OPTIONS, expires_in_seconds=901)
    assert raised.value.field == "expires_in_seconds"


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"expires_in_seconds": True}, "expires_in_seconds"),
        ({"now": datetime(2026, 11, 13, 12)}, "now"),
        ({"constraints": [{"filter": "x", "operator": "eq", "value": 3.0}]}, "constraints"),
        ({"constraints": [{"filter": "x", "operator": "eq", "value": "a\ud800"}]}, "constraints"),
        ({"constraints": [{"filter": "x", "operator": "in", "value": "ab"}]}, "constraints"),
        ({"constraints": "region"}, "constraints"),
        ({"signing_key": b"{}"}, "signing_key"),
    ],
)
def test_refuses_python_only_mistakes(override: dict[str, Any], field: str) -> None:
    with pytest.raises(AgentTokenError) as raised:
        mint_agent_token(**{**OPTIONS, **override})
    assert raised.value.field == field
    assert isinstance(raised.value, ValueError)


def test_counts_string_length_as_typescript_does() -> None:
    # 128 astral characters are 256 UTF-16 units: the most a value may have.
    longest = "\U0001f69a" * 128
    mint_agent_token(**OPTIONS, constraints=[{"filter": "x", "operator": "eq", "value": longest}])
    with pytest.raises(AgentTokenError):
        mint_agent_token(
            **OPTIONS, constraints=[{"filter": "x", "operator": "eq", "value": longest + "a"}]
        )


def test_audience_names_the_project() -> None:
    assert agent_token_audience("acme:logistics") == "hypequery-agent:acme:logistics"
    with pytest.raises(AgentTokenError):
        agent_token_audience("acme/logistics")


def test_repr_leaves_the_token_out() -> None:
    minted = mint_agent_token(**OPTIONS)
    assert isinstance(minted, AgentToken)
    assert minted.token not in repr(minted)
    assert minted.mcp_url in repr(minted)


def test_imports_without_the_jwt_extra_and_minting_asks_for_it() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            textwrap.dedent(
                f"""
                import sys

                sys.modules["cryptography"] = None
                from hypequery.agent import mint_agent_token

                try:
                    mint_agent_token(**{OPTIONS!r})
                except ModuleNotFoundError as exc:
                    assert 'pip install "hypequery[jwt]"' in str(exc), exc
                else:
                    raise AssertionError("minting must ask for the jwt extra")
                """
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
