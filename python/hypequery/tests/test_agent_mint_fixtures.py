"""Runs the language-neutral mint fixtures (specs/agent-token/fixtures/mint-v1).

`mint_agent_token()` must mint each accepted case's token byte for byte, which
`@hypequery/agent`'s `mintAgentToken()` also mints (`mint-fixtures.test.ts`
runs the same file), so a token from either language is the same token. Each
must pass Cloud's verifier (AG-18a), ported in `agent_verifier.py`, and each
refused case must be refused naming the same option.
"""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("cryptography")
pytest.importorskip("jwt")

from agent_verifier import signing_key_audience, verify_signing_key_jwt
from hypequery.agent import AgentTokenError, mint_agent_token

FIXTURES: dict[str, Any] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "specs/agent-token/fixtures/mint-v1/cases.json"
    ).read_text(encoding="utf-8")
)
SIGNING_KEY = json.dumps(FIXTURES["signingKey"])
PUBLIC_KEY = {"kid": FIXTURES["signingKey"]["kid"], "publicKey": FIXTURES["signingKey"]["x"]}
BASE = {
    "project": "acme:logistics",
    "endpoint": "https://acme-logistics-1f2e3d4c.hypequery.app",
    "tenant": "northwind",
    "subject": "user_42",
    "permissionSet": "customers",
}
#: The fixture names options as TypeScript does.
OPTION_NAMES = {
    "signingKey": "signing_key",
    "project": "project",
    "endpoint": "endpoint",
    "tenant": "tenant",
    "subject": "subject",
    "permissionSet": "permission_set",
    "constraints": "constraints",
    "expiresInSeconds": "expires_in_seconds",
    "now": "now",
}


def options(fixture_input: dict[str, Any]) -> dict[str, Any]:
    """Python keyword arguments for a fixture input. A null option, which
    TypeScript omits, is passed as None: both must refuse it, naming it."""

    return {OPTION_NAMES[name]: value for name, value in fixture_input.items()}


def decode(part: str) -> Any:
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


@pytest.mark.parametrize("case", FIXTURES["accepted"], ids=lambda case: case["name"])
def test_mints_the_fixture_token_byte_for_byte(case: dict[str, Any]) -> None:
    minted = mint_agent_token(
        **options(case["input"]),
        signing_key=SIGNING_KEY,
        now=datetime.fromtimestamp(case["now"], UTC),
    )
    assert minted.token == case["token"]
    assert minted.mcp_url == case["mcpUrl"]
    assert minted.expires_at == datetime.fromtimestamp(case["expiresAt"], UTC)
    header, payload, _ = minted.token.split(".")
    assert decode(header) == case["header"]
    assert decode(payload) == case["payload"]


@pytest.mark.parametrize("case", FIXTURES["accepted"], ids=lambda case: case["name"])
def test_passes_the_ag18a_verifier_for_its_lifetime_and_not_after(case: dict[str, Any]) -> None:
    audience = signing_key_audience(case["input"]["project"])
    payload = case["payload"]
    expected = {
        "subject": payload["sub"],
        "tenantId": payload["tenant"],
        "permissionSetName": payload["permission_set"],
        "constraints": payload.get("constraints", []),
    }
    for now in (case["now"], payload["exp"] - 1):
        assert verify_signing_key_jwt(case["token"], PUBLIC_KEY, audience, now) == expected
    assert verify_signing_key_jwt(case["token"], PUBLIC_KEY, audience, payload["exp"] + 31) is None
    other = signing_key_audience("other:project")
    assert verify_signing_key_jwt(case["token"], PUBLIC_KEY, other, case["now"]) is None


@pytest.mark.parametrize("case", FIXTURES["refused"], ids=lambda case: case["name"])
def test_refuses_the_fixture_input(case: dict[str, Any]) -> None:
    arguments = options({**BASE, **case.get("input", {})})
    arguments["signing_key"] = case.get("signingKey", SIGNING_KEY)
    with pytest.raises(AgentTokenError) as raised:
        mint_agent_token(**arguments, now=datetime.fromtimestamp(1_763_000_000, UTC))
    assert raised.value.field == OPTION_NAMES[case["field"]]
    assert FIXTURES["signingKey"]["d"] not in str(raised.value)
