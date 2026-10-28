"""Runs the language-neutral JWT fixtures (specs/serve-http/fixtures/jwt-v1).

Each accepted token must map to the fixture's principal and each refused token
must be refused, by `jwt_strategy` directly and through the framework-neutral
core's `Api.handle`. The Python issuer must mint the fixture's Python token, and
both languages' tokens must carry the same claims.

`@hypequery/serve` runs the same file in `serve-jwt-fixtures.test.ts`. A
divergence between the two is a bug in one of them or in the fixtures.
"""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from core_transport import CoreClient
from hypequery.serve import (
    Credential,
    InvalidCredential,
    JwtStrategy,
    analytics_token_issuer,
    create_api,
    jwt_strategy,
)
from hypequery.serve.core import Call, ServeResponse, jwt_auth
from jwks_server import JwksServer

FIXTURES: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "specs/serve-http/fixtures/jwt-v1/cases.json").read_text(
        encoding="utf-8"
    )
)


@pytest.fixture(scope="module")
def strategies() -> Iterator[dict[str, JwtStrategy]]:
    with JwksServer(FIXTURES["jwks"]) as server:
        built = {}
        for name, verifier in FIXTURES["verifiers"].items():
            options: dict[str, Any] = {
                "issuer": verifier.get("issuer"),
                "audience": verifier.get("audience"),
                "algorithms": verifier.get("algorithms"),
            }
            if verifier["key"] == "secret":
                built[name] = jwt_strategy(secret=FIXTURES["secret"], **options)
            else:
                built[name] = jwt_strategy(jwks_url=server.url, **options)
        yield built


def _principal_json(call: Call) -> dict[str, Any]:
    assert call.auth is not None
    principal = call.auth.principal
    return {
        "subject": principal.subject,
        "tenantId": principal.tenant_id,
        "roles": sorted(principal.roles),
        "scopes": sorted(principal.scopes),
    }


def _client(strategy: JwtStrategy) -> CoreClient:
    async def whoami(call: Call) -> ServeResponse:
        return ServeResponse.json(_principal_json(call))

    api = create_api(auth=strategy)
    api.add_route("GET", "/whoami", whoami)
    return CoreClient(api)


def _ids(cases: list[dict[str, Any]]) -> list[str]:
    return [case["id"] for case in cases]


@pytest.mark.parametrize("case", FIXTURES["accept"], ids=_ids(FIXTURES["accept"]))
def test_accepted(case: dict[str, Any], strategies: dict[str, JwtStrategy]) -> None:
    strategy = strategies[case["verifier"]]
    principal = asyncio.run(strategy(Credential("bearer", case["token"])))
    assert principal is not None
    assert {
        "subject": principal.subject,
        "tenantId": principal.tenant_id,
        "roles": sorted(principal.roles),
        "scopes": sorted(principal.scopes),
    } == case["principal"]

    response = _client(strategy).request(
        "GET", "/whoami", headers={"Authorization": f"Bearer {case['token']}"}
    )
    assert response.status_code == 200
    assert response.json() == case["principal"]


@pytest.mark.parametrize("case", FIXTURES["reject"], ids=_ids(FIXTURES["reject"]))
def test_refused(case: dict[str, Any], strategies: dict[str, JwtStrategy]) -> None:
    strategy = strategies[case["verifier"]]
    with pytest.raises(InvalidCredential):
        asyncio.run(strategy(Credential("bearer", case["token"])))

    response = _client(strategy).request(
        "GET", "/whoami", headers={"Authorization": f"Bearer {case['token']}"}
    )
    refusal = FIXTURES["refusal"]
    error = response.json()["error"]
    assert response.status_code == refusal["status"]
    assert error["type"] == refusal["type"]
    assert error["message"] == refusal["message"]
    assert error["details"].items() >= refusal["details"].items()


def _payload(token: str) -> dict[str, Any]:
    encoded = token.split(".")[1]
    decoded: dict[str, Any] = json.loads(
        base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    )
    return decoded


def test_issuer_mints_the_fixture_token(monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = FIXTURES["issuer"]
    options, claims = fixture["options"], fixture["claims"]
    monkeypatch.setattr(jwt_auth, "_clock", lambda: fixture["issuedAt"])
    issue = analytics_token_issuer(
        FIXTURES["secret"],
        issuer=options["issuer"],
        audience=options["audience"],
        expires_in=options["expiresInSeconds"],
    )

    token = issue(claims["subject"], tenant_id=claims["tenantId"], roles=claims["roles"])

    assert token == fixture["tokens"]["python"]
    # Both languages' tokens carry the same claims, in the same order.
    for minted in fixture["tokens"].values():
        assert list(_payload(minted).items()) == list(fixture["payload"].items())
