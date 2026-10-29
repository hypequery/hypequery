"""PYD-01: an API authenticates every route unless the route is declared public.

The acceptance criteria this pins:
- an unauthenticated request to any route fails closed by default, and no
  body byte is read before authentication;
- nothing in a request other than the credential, whether headers, query,
  body, or cookies, can supply or alter the auth context or the tenant.
"""

from __future__ import annotations

import asyncio
import pickle
from collections.abc import AsyncIterator, Callable
from typing import Any

import pytest
from pydantic import TypeAdapter

from asgi_client import AsgiClient
from hypequery.datasets import all_tenants, tenant, tenants
from hypequery.serve import (
    MAX_CREDENTIAL_LENGTH,
    Api,
    Call,
    Credential,
    Headers,
    InvalidCredential,
    Principal,
    RequestAuth,
    ServeRequest,
    ServeResponse,
    api_key,
    bearer_token,
    create_api,
    to_asgi_app,
)

TOKEN = "good-token"  # noqa: S105 - a test credential
ALICE = Principal(subject="alice", roles=frozenset({"analyst"}), tenant_id="acme")
OBJECT: TypeAdapter[object] = TypeAdapter(dict[str, Any])


class _Authenticator:
    """Accepts TOKEN and records every credential it was shown."""

    def __init__(self, principal: Principal = ALICE) -> None:
        self.principal = principal
        self.seen: list[Credential] = []

    def __call__(self, credential: Credential) -> Principal | None:
        self.seen.append(credential)
        return self.principal if credential.value == TOKEN else None


def _described(auth: RequestAuth | None) -> dict[str, Any]:
    assert auth is not None
    scope = auth.tenant
    return {
        "subject": auth.principal.subject,
        "tenants": sorted(scope.ids) if scope is not None else None,
    }


async def _whoami(call: Call) -> ServeResponse:
    return ServeResponse.json(_described(call.auth))


async def _ok(call: Call) -> ServeResponse:
    return ServeResponse.json({"ok": True})


def _app(api: Api) -> AsgiClient:
    api.add_route("GET", "/whoami", _whoami)
    api.add_route("POST", "/whoami", _whoami, input=OBJECT)
    return AsgiClient(to_asgi_app(api))


def _bearer(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --- fail closed by default -----------------------------------------------


def test_a_request_without_credentials_is_refused_before_the_authenticator() -> None:
    authenticator = _Authenticator()
    client = _app(create_api(auth=authenticator))

    response = client.get("/whoami")

    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "type": "UNAUTHORIZED",
            "message": "Access denied",
            "details": {"reason": "missing_credentials"},
        }
    }
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["cache-control"] == "no-store"
    assert authenticator.seen == []


def test_the_default_tenant_resolver_runs_inline(monkeypatch: pytest.MonkeyPatch) -> None:
    # It is pure: a worker thread per request would only queue it behind queries.
    from hypequery.serve.core.work import RequestWork

    started: list[object] = []
    monkeypatch.setattr(
        RequestWork, "start_sync", lambda self, function, *a, **k: started.append(function)
    )

    async def authenticate(credential: Credential) -> Principal | None:
        return ALICE if credential.value == TOKEN else None

    api = create_api(auth=authenticate)
    api.add_route("GET", "/whoami", _whoami)
    request = ServeRequest(
        method="GET",
        path="/whoami",
        headers=Headers([("authorization", f"Bearer {TOKEN}")]),
    )
    response = asyncio.run(api.handle(request))

    assert response.status == 200
    assert started == []


def test_a_valid_credential_reaches_the_endpoint_with_its_tenant() -> None:
    client = _app(create_api(auth=_Authenticator()))

    response = client.get("/whoami", headers=_bearer())

    assert response.status_code == 200
    assert response.json() == {"subject": "alice", "tenants": ["acme"]}


def test_the_bearer_scheme_is_case_insensitive() -> None:
    client = _app(create_api(auth=_Authenticator()))

    assert client.get("/whoami", headers={"Authorization": f"bearer {TOKEN}"}).status_code == 200


@pytest.mark.parametrize(
    "value",
    [
        f"Basic {TOKEN}",
        "Bearer",
        "Bearer ",
        f"Bearer {TOKEN} extra",
        f"Bearer {TOKEN}\t",
        f"Token {TOKEN}",
        TOKEN,
        "Bearer " + "a" * MAX_CREDENTIAL_LENGTH,
    ],
)
def test_a_malformed_credential_never_reaches_the_authenticator(value: str) -> None:
    authenticator = _Authenticator()
    client = _app(create_api(auth=authenticator))

    assert client.get("/whoami", headers={"Authorization": value}).status_code == 401
    assert authenticator.seen == []


def test_a_repeated_authorization_header_is_refused() -> None:
    authenticator = _Authenticator()
    client = _app(create_api(auth=authenticator))

    response = client.get(
        "/whoami",
        headers=[("Authorization", f"Bearer {TOKEN}"), ("Authorization", "Bearer other")],
    )

    assert response.status_code == 401
    assert authenticator.seen == []


def test_a_credential_outside_the_configured_header_is_ignored() -> None:
    authenticator = _Authenticator()
    client = _app(create_api(auth=authenticator))

    for response in (
        client.get("/whoami", params={"access_token": TOKEN, "api_key": TOKEN}),
        client.get("/whoami", headers={"X-Api-Key": TOKEN}),
        client.get("/whoami", headers={"Cookie": f"authorization=Bearer {TOKEN}"}),
    ):
        assert response.status_code == 401
    assert authenticator.seen == []


def test_a_rejected_credential_differs_from_a_missing_one_only_in_its_reason() -> None:
    # As in TypeScript serve. The caller knows whether it sent a credential,
    # so the reason tells it nothing new.
    client = _app(create_api(auth=_Authenticator()))

    missing = client.get("/whoami")
    rejected = client.get("/whoami", headers=_bearer("wrong"))
    malformed = client.get("/whoami", headers={"Authorization": "Basic x"})

    assert rejected.status_code == missing.status_code == malformed.status_code == 401
    assert missing.json()["error"]["details"] == {"reason": "missing_credentials"}
    for response in (rejected, malformed):
        assert response.json()["error"]["details"] == {"reason": "invalid_credentials"}
        assert response.json()["error"]["message"] == missing.json()["error"]["message"]


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
def test_every_method_is_authenticated(method: str) -> None:
    api = create_api(auth=_Authenticator())
    api.add_route(method, "/any", _ok)
    client = AsgiClient(to_asgi_app(api))

    assert client.request(method, "/any").status_code == 401
    assert client.request(method, "/any", headers=_bearer()).status_code == 200


def test_the_api_stays_authenticated_under_its_base_path_and_a_mount() -> None:
    api = create_api(auth=_Authenticator(), base_path="/hq")
    api.add_route("POST", "/query", _ok)
    served = AsgiClient(to_asgi_app(api))
    # Mounted as a host framework mounts an ASGI app: below a root_path.
    mounted = AsgiClient(to_asgi_app(api), root_path="/api")
    for client, path in ((served, "/hq/query"), (mounted, "/api/hq/query")):
        assert client.post(path).status_code == 401
        assert client.post(path, headers=_bearer()).status_code == 200


def test_authentication_runs_before_the_handler() -> None:
    ran: list[str] = []

    async def work(call: Call) -> ServeResponse:
        ran.append("handler")
        return ServeResponse.json({"ok": True})

    api = create_api(auth=_Authenticator())
    api.add_route("GET", "/work", work)
    client = AsgiClient(to_asgi_app(api))

    assert client.get("/work").status_code == 401
    assert ran == []
    assert client.get("/work", headers=_bearer()).status_code == 200
    assert ran == ["handler"]


def test_authentication_runs_once_per_request() -> None:
    authenticator = _Authenticator()
    client = _app(create_api(auth=authenticator))

    client.get("/whoami", headers=_bearer())

    assert len(authenticator.seen) == 1


# --- public routes are an explicit opt-in ---------------------------------


def test_a_public_route_needs_no_credentials() -> None:
    api = create_api(auth=_Authenticator())
    api.add_route("GET", "/health", _ok, public=True)
    api.add_route("GET", "/private", _ok)
    client = AsgiClient(to_asgi_app(api))

    assert client.get("/health").status_code == 200
    assert "cache-control" not in client.get("/health").headers
    assert client.get("/private").status_code == 401


# --- nothing is read before authentication --------------------------------


def _request(content: bytes, reads: list[str], headers: dict[str, str]) -> ServeRequest:
    async def body() -> AsyncIterator[bytes]:
        reads.append("body")
        yield content

    sent = {"host": "testserver", "content-type": "application/json", **headers}
    return ServeRequest(method="POST", path="/hq/query", headers=Headers(sent.items()), body=body())


def test_an_unauthenticated_body_is_never_read() -> None:
    api = create_api(auth=_Authenticator(), base_path="/hq")
    api.add_route("POST", "/query", _ok, input=OBJECT)
    reads: list[str] = []

    for content in (b"{not json", b'{"a": "' + b"x" * 1_000_000 + b'"}'):
        response = asyncio.run(api.handle(_request(content, reads, {})))
        assert response.status == 401
    assert reads == []

    authed = asyncio.run(api.handle(_request(b'{"a": 1}', reads, _bearer())))
    assert authed.status == 200
    assert reads == ["body"]


def test_early_authentication_is_reused_by_the_handler() -> None:
    authenticator = _Authenticator()
    client = _app(create_api(auth=authenticator))

    response = client.post("/whoami", json={}, headers=_bearer())
    assert response.json() == {"subject": "alice", "tenants": ["acme"]}
    assert len(authenticator.seen) == 1


# --- nothing in the request can forge the context -------------------------


def test_request_input_cannot_supply_the_auth_context_or_tenant() -> None:
    client = _app(create_api(auth=_Authenticator()))

    forged = client.post("/whoami", json={"tenant": "globex", "subject": "mallory"})
    assert forged.status_code == 401

    response = client.post(
        "/whoami",
        headers={**_bearer(), "X-Tenant-Id": "globex", "X-Hypequery-Tenant": "globex"},
        params={"tenant": "globex", "tenantId": "globex"},
        json={"tenant": "globex", "principal": {"subject": "mallory"}},
    )
    assert response.status_code == 200
    assert response.json() == {"subject": "alice", "tenants": ["acme"]}


def test_the_authenticator_sees_only_the_credential() -> None:
    authenticator = _Authenticator()
    client = _app(create_api(auth=authenticator))

    client.get("/whoami", headers={**_bearer(), "X-Tenant-Id": "globex"})

    [credential] = authenticator.seen
    assert type(credential) is Credential
    assert (credential.kind, credential.value) == ("bearer", TOKEN)


# --- providers fail closed ------------------------------------------------


def test_an_async_authenticator_is_awaited() -> None:
    async def authenticate(credential: Credential) -> Principal | None:
        await asyncio.sleep(0)
        return ALICE if credential.value == TOKEN else None

    client = _app(create_api(auth=authenticate))

    assert client.get("/whoami", headers=_bearer()).status_code == 200
    assert client.get("/whoami", headers=_bearer("wrong")).status_code == 401


def test_a_sync_provider_runs_off_the_event_loop() -> None:
    on_loop: list[bool] = []

    def running_on_loop() -> bool:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return False
        return True

    def authenticate(credential: Credential) -> Principal:
        on_loop.append(running_on_loop())
        return ALICE

    def resolve(principal: Principal) -> None:
        on_loop.append(running_on_loop())

    client = _app(create_api(auth=authenticate, tenant=resolve))

    assert client.get("/whoami", headers=_bearer()).status_code == 200
    assert on_loop == [False, False]


def test_an_authenticator_can_reject_by_raising_invalid_credential() -> None:
    def authenticate(credential: Credential) -> Principal:
        raise InvalidCredential("signature verification failed")

    client = _app(create_api(auth=authenticate))
    response = client.get("/whoami", headers=_bearer())

    assert response.status_code == 401
    assert response.json()["error"]["details"] == {"reason": "invalid_credentials"}
    assert "signature" not in response.text


def test_invalid_credential_from_a_resolver_is_a_provider_failure() -> None:
    def resolve(principal: Principal) -> None:
        raise InvalidCredential

    client = _app(create_api(auth=_Authenticator(), tenant=resolve))

    assert client.get("/whoami", headers=_bearer()).status_code == 503


def test_a_failing_authenticator_fails_closed_without_detail() -> None:
    def authenticate(credential: Credential) -> Principal | None:
        raise RuntimeError(f"jwks fetch failed for {credential.value} at 10.0.0.7")

    client = _app(create_api(auth=authenticate))
    response = client.get("/whoami", headers=_bearer())

    assert response.status_code == 503
    assert response.json() == {
        "error": {"type": "SERVICE_UNAVAILABLE", "message": "Authentication is unavailable."}
    }
    assert TOKEN not in response.text
    assert "10.0.0.7" not in response.text


@pytest.mark.parametrize(
    "returned", [{"subject": "alice"}, "alice", True, RequestAuth(principal=ALICE)]
)
def test_an_authenticator_returning_anything_but_a_principal_fails_closed(
    returned: object,
) -> None:
    client = _app(create_api(auth=lambda credential: returned))  # type: ignore[arg-type,return-value]

    response = client.get("/whoami", headers=_bearer())

    assert response.status_code == 500
    assert response.json()["error"] == {
        "type": "INTERNAL_SERVER_ERROR",
        "message": "An unexpected error occurred",
    }


def test_a_principal_without_a_tenant_is_tenant_free() -> None:
    authenticator = _Authenticator(Principal(subject="bot"))
    client = _app(create_api(auth=authenticator))

    assert client.get("/whoami", headers=_bearer()).json() == {"subject": "bot", "tenants": None}


def test_a_custom_tenant_resolver_decides_the_tenant() -> None:
    async def resolve(principal: Principal) -> Any:
        return tenant(f"org-of-{principal.subject}")

    client = _app(create_api(auth=_Authenticator(), tenant=resolve))

    assert client.get("/whoami", headers=_bearer()).json()["tenants"] == ["org-of-alice"]


def test_a_resolver_can_return_a_single_tenant_set() -> None:
    client = _app(create_api(auth=_Authenticator(), tenant=lambda principal: tenants(("a",))))

    assert client.get("/whoami", headers=_bearer()).json()["tenants"] == ["a"]


@pytest.mark.parametrize(
    "resolved", [all_tenants(), tenants(("a", "b")), {"ids": ["acme"]}, "acme"]
)
def test_a_resolver_requires_one_named_tenant(resolved: object) -> None:
    client = _app(
        create_api(auth=_Authenticator(), tenant=lambda principal: resolved)  # type: ignore[arg-type,return-value]
    )

    response = client.get("/whoami", headers=_bearer())

    assert response.status_code == 500
    assert response.json()["error"] == {
        "type": "INTERNAL_SERVER_ERROR",
        "message": "An unexpected error occurred",
    }


def test_a_failing_resolver_fails_closed() -> None:
    def resolve(principal: Principal) -> None:
        raise LookupError("tenant table unavailable")

    client = _app(create_api(auth=_Authenticator(), tenant=resolve))

    response = client.get("/whoami", headers=_bearer())
    assert response.status_code == 503
    assert "tenant table" not in response.text


# --- API key transport ----------------------------------------------------


def test_an_api_key_is_read_from_its_header_only() -> None:
    authenticator = _Authenticator()
    client = _app(create_api(auth=authenticator, credentials=api_key()))

    assert client.get("/whoami", headers=_bearer()).status_code == 401
    missing = client.get("/whoami")
    assert "www-authenticate" not in missing.headers
    assert client.get("/whoami", headers={"X-Api-Key": TOKEN}).status_code == 200
    assert [c.kind for c in authenticator.seen] == ["api-key"]


@pytest.mark.parametrize("value", ["has space", "tab\there", "é-unicode"])
def test_an_api_key_outside_visible_ascii_is_refused(value: str) -> None:
    authenticator = _Authenticator()
    client = _app(create_api(auth=authenticator, credentials=api_key()))

    assert client.get("/whoami", headers={"X-Api-Key": value.encode()}).status_code == 401
    assert authenticator.seen == []


# --- the types themselves -------------------------------------------------


def test_credentials_and_principals_never_print_secrets() -> None:
    credential = Credential("bearer", "s3cret-token")
    principal = Principal(subject="alice@example.com", tenant_id="acme-secret")

    assert "s3cret" not in repr(credential)
    assert "alice" not in repr(principal)
    assert "secret" not in repr(principal)
    assert "secret" not in repr(RequestAuth(principal=principal, tenant=tenant("acme-secret")))
    with pytest.raises(TypeError):
        pickle.dumps(credential)


@pytest.mark.parametrize(
    "build",
    [
        lambda: Principal(subject=""),
        lambda: Principal(subject="a", roles={"admin"}),  # type: ignore[arg-type]
        lambda: Principal(subject="a", scopes=frozenset({1})),  # type: ignore[arg-type]
        lambda: Principal(subject="a", tenant_id=""),
        lambda: RequestAuth(principal={"subject": "a"}),  # type: ignore[arg-type]
        lambda: RequestAuth(principal=ALICE, tenant=all_tenants()),
        lambda: RequestAuth(principal=ALICE, tenant=tenants(("a", "b"))),
    ],
)
def test_auth_types_reject_invalid_values(build: Callable[[], object]) -> None:
    with pytest.raises(TypeError):
        build()


def test_create_api_validates_its_configuration() -> None:
    with pytest.raises(TypeError):
        create_api(auth="not callable")  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        create_api(auth=_Authenticator(), tenant="nope")  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        create_api(auth=_Authenticator(), openapi="docs")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="base_path"):
        create_api(auth=_Authenticator(), base_path="/trailing/")
    with pytest.raises(TypeError):
        create_api(auth=_Authenticator(), credentials="bearer")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="header name"):
        bearer_token(header="Authorization: x")
