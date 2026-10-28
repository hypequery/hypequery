"""JWT bearer authentication through every adapter, the native ones included.

`jwt_strategy` is an ordinary authenticator, so every transport reaches it the
same way; this checks that it runs under the WSGI adapter's serving loop and
inside Django and Flask as it does under ASGI.
"""

from __future__ import annotations

import jwt
import pytest

from hypequery.serve import (
    Api,
    Call,
    ServeResponse,
    analytics_token_issuer,
    create_api,
    jwt_strategy,
)
from serve_transports import TRANSPORTS, serve_client

SECRET = "a-shared-secret-of-at-least-thirty-two-bytes"  # noqa: S105 - a test secret
ISSUER = "https://app.example.com"
AUDIENCE = "analytics"


def _api() -> Api:
    async def whoami(call: Call) -> ServeResponse:
        assert call.auth is not None
        principal = call.auth.principal
        return ServeResponse.json({"sub": principal.subject, "tenant": principal.tenant_id})

    api = create_api(auth=jwt_strategy(secret=SECRET, issuer=ISSUER, audience=AUDIENCE))
    api.add_route("GET", "/whoami", whoami)
    return api


@pytest.mark.parametrize("transport", TRANSPORTS)
def test_a_valid_jwt_is_accepted_and_an_invalid_one_refused(transport: str) -> None:
    issue = analytics_token_issuer(SECRET, issuer=ISSUER, audience=AUDIENCE)
    client = serve_client(transport, _api())

    valid = client.request(
        "GET", "/whoami", headers={"authorization": f"Bearer {issue('alice', tenant_id='acme')}"}
    )
    assert valid.status_code == 200, valid.text
    assert valid.json() == {"sub": "alice", "tenant": "acme"}

    forged = jwt.encode(
        {"sub": "mallory", "iss": ISSUER, "aud": AUDIENCE},
        "another-secret-of-at-least-thirty-two-bytes",
        algorithm="HS256",
    )
    wrong_audience = analytics_token_issuer(SECRET, issuer=ISSUER, audience="other")("alice")
    for token in (forged, wrong_audience, "not-a-jwt"):
        refused = client.request("GET", "/whoami", headers={"authorization": f"Bearer {token}"})
        assert refused.status_code == 401, (token, refused.text)
        assert refused.json()["error"]["type"] == "UNAUTHORIZED"
