"""PYD-01: the serve router authenticates every endpoint unless declared public.

The acceptance criteria this pins:
- an unauthenticated request to any endpoint fails closed by default, however
  the endpoint was added and however the router is included;
- nothing in a request other than the credential, whether headers, query,
  body, cookies, or request state, can supply or alter the auth context or
  the tenant.
"""

# No `from __future__ import annotations`: FastAPI resolves endpoint
# annotations at registration, and these endpoints close over local routers.
import asyncio
import pickle
from collections.abc import Callable
from typing import Annotated, Any

import pytest
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from hypequery.datasets import all_tenants, tenant
from hypequery.serve import (
    MAX_CREDENTIAL_LENGTH,
    Credential,
    Principal,
    RequestAuth,
    ServeRouter,
    api_key,
    bearer_token,
    create_router,
)

TOKEN = "good-token"  # noqa: S105 - a test credential
ALICE = Principal(subject="alice", roles=frozenset({"analyst"}), tenant_id="acme")


class _Authenticator:
    """Accepts TOKEN and records every credential it was shown."""

    def __init__(self, principal: Principal = ALICE) -> None:
        self.principal = principal
        self.seen: list[Credential] = []

    def __call__(self, credential: Credential) -> Principal | None:
        self.seen.append(credential)
        return self.principal if credential.value == TOKEN else None


def _described(auth: RequestAuth) -> dict[str, Any]:
    scope = auth.tenant
    return {
        "subject": auth.principal.subject,
        "tenants": sorted(scope.ids) if scope is not None else None,
    }


def _app(router: ServeRouter) -> TestClient:
    @router.get("/whoami")
    def whoami(auth: Annotated[RequestAuth, Depends(router.auth)]) -> dict[str, Any]:
        return _described(auth)

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _bearer(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --- fail closed by default -----------------------------------------------


def test_a_request_without_credentials_is_refused_before_the_authenticator() -> None:
    authenticator = _Authenticator()
    client = _app(create_router(authenticate=authenticator))

    response = client.get("/whoami")

    assert response.status_code == 401
    assert response.json() == {
        "detail": {"category": "unauthenticated", "message": "Authentication required."}
    }
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["cache-control"] == "no-store"
    assert authenticator.seen == []


def test_a_valid_credential_reaches_the_endpoint_with_its_tenant() -> None:
    client = _app(create_router(authenticate=_Authenticator()))

    response = client.get("/whoami", headers=_bearer())

    assert response.status_code == 200
    assert response.json() == {"subject": "alice", "tenants": ["acme"]}


def test_the_bearer_scheme_is_case_insensitive() -> None:
    client = _app(create_router(authenticate=_Authenticator()))

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
    client = _app(create_router(authenticate=authenticator))

    assert client.get("/whoami", headers={"Authorization": value}).status_code == 401
    assert authenticator.seen == []


def test_a_repeated_authorization_header_is_refused() -> None:
    authenticator = _Authenticator()
    client = _app(create_router(authenticate=authenticator))

    response = client.get(
        "/whoami",
        headers=[("Authorization", f"Bearer {TOKEN}"), ("Authorization", "Bearer other")],
    )

    assert response.status_code == 401
    assert authenticator.seen == []


def test_a_credential_outside_the_configured_header_is_ignored() -> None:
    authenticator = _Authenticator()
    client = _app(create_router(authenticate=authenticator))
    client.cookies.set("authorization", f"Bearer {TOKEN}")

    for response in (
        client.get("/whoami", params={"access_token": TOKEN, "api_key": TOKEN}),
        client.get("/whoami", headers={"X-Api-Key": TOKEN}),
    ):
        assert response.status_code == 401
    assert authenticator.seen == []


def test_a_rejected_credential_is_indistinguishable_from_a_missing_one() -> None:
    client = _app(create_router(authenticate=_Authenticator()))

    missing = client.get("/whoami")
    rejected = client.get("/whoami", headers=_bearer("wrong"))

    assert rejected.status_code == missing.status_code == 401
    assert rejected.json() == missing.json()


@pytest.mark.parametrize("method", ["get", "post", "put", "patch", "delete", "head", "options"])
def test_every_method_is_authenticated(method: str) -> None:
    router = create_router(authenticate=_Authenticator())
    router.add_api_route("/any", lambda: {"ok": True}, methods=[method.upper()])
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    assert client.request(method.upper(), "/any").status_code == 401
    assert client.request(method.upper(), "/any", headers=_bearer()).status_code == 200


def test_the_router_stays_authenticated_however_it_is_included() -> None:
    router = create_router(authenticate=_Authenticator(), prefix="/hq")

    @router.post("/query")
    def query() -> dict[str, bool]:
        return {"ok": True}

    outer = APIRouter(prefix="/api")
    outer.include_router(router)
    app = FastAPI()
    app.include_router(outer)
    app.include_router(router, prefix="/v2")
    client = TestClient(app)

    for path in ("/api/hq/query", "/v2/hq/query"):
        assert client.post(path).status_code == 401
        assert client.post(path, headers=_bearer()).status_code == 200


def test_authentication_runs_before_the_endpoint_dependencies() -> None:
    ran: list[str] = []
    router = create_router(authenticate=_Authenticator())

    def expensive() -> None:
        ran.append("dependency")

    @router.get("/work", dependencies=[Depends(expensive)])
    def work(_: Annotated[None, Depends(expensive)]) -> dict[str, bool]:
        ran.append("endpoint")
        return {"ok": True}

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    assert client.get("/work").status_code == 401
    assert ran == []
    assert client.get("/work", headers=_bearer()).status_code == 200
    assert ran == ["dependency", "endpoint"]


def test_authentication_runs_once_per_request() -> None:
    authenticator = _Authenticator()
    client = _app(create_router(authenticate=authenticator))

    client.get("/whoami", headers=_bearer())

    assert len(authenticator.seen) == 1


# --- public endpoints are an explicit opt-in ------------------------------


def test_a_public_endpoint_needs_no_credentials() -> None:
    router = create_router(authenticate=_Authenticator())

    @router.get("/health")
    @router.public
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app = FastAPI()
    app.include_router(router)

    assert TestClient(app).get("/health").status_code == 200


def test_marking_public_after_registering_leaves_the_route_authenticated() -> None:
    router = create_router(authenticate=_Authenticator())

    @router.public
    @router.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app = FastAPI()
    app.include_router(router)

    assert TestClient(app).get("/health").status_code == 401


def test_public_on_one_router_does_not_open_another() -> None:
    first = create_router(authenticate=_Authenticator())
    second = create_router(authenticate=_Authenticator())

    def health() -> dict[str, str]:
        return {"status": "ok"}

    first.public(health)
    first.add_api_route("/first", health)
    second.add_api_route("/second", health)
    app = FastAPI()
    app.include_router(first)
    app.include_router(second)
    client = TestClient(app)

    assert client.get("/first").status_code == 200
    assert client.get("/second").status_code == 401


# --- routes that would skip authentication are refused --------------------


@pytest.mark.parametrize(
    "register",
    [
        lambda r: r.include_router(APIRouter()),
        lambda r: r.add_route("/raw", lambda request: Response()),
        lambda r: r.mount("/static", FastAPI()),
        lambda r: r.add_websocket_route("/ws", lambda ws: None),
        lambda r: r.add_api_websocket_route("/ws", lambda ws: None),
        lambda r: r.websocket("/ws")(lambda ws: None),
        lambda r: r.route("/raw")(lambda request: Response()),
    ],
)
def test_registrations_that_skip_authentication_are_refused(
    register: Callable[[ServeRouter], object],
) -> None:
    router = create_router(authenticate=_Authenticator())

    with pytest.raises(TypeError):
        register(router)


# --- nothing in the request can forge the context -------------------------


class _ForgeState(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Any) -> Response:
        forged = RequestAuth(principal=Principal(subject="mallory"), tenant=tenant("globex"))
        request.state.auth = forged
        request.state.tenant = tenant("globex")
        request.scope["auth"] = forged
        response: Response = await call_next(request)
        return response


def test_request_input_cannot_supply_the_auth_context_or_tenant() -> None:
    router = create_router(authenticate=_Authenticator())

    @router.post("/whoami")
    def whoami(auth: Annotated[RequestAuth, Depends(router.auth)]) -> dict[str, Any]:
        return _described(auth)

    app = FastAPI()
    app.add_middleware(_ForgeState)
    app.include_router(router)
    client = TestClient(app)

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
    client = _app(create_router(authenticate=authenticator))

    client.get("/whoami", headers={**_bearer(), "X-Tenant-Id": "globex"})

    [credential] = authenticator.seen
    assert type(credential) is Credential
    assert (credential.kind, credential.value) == ("bearer", TOKEN)


# --- providers fail closed ------------------------------------------------


def test_an_async_authenticator_is_awaited() -> None:
    async def authenticate(credential: Credential) -> Principal | None:
        await asyncio.sleep(0)
        return ALICE if credential.value == TOKEN else None

    client = _app(create_router(authenticate=authenticate))

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

    client = _app(create_router(authenticate=authenticate, resolve_tenant=resolve))

    assert client.get("/whoami", headers=_bearer()).status_code == 200
    assert on_loop == [False, False]


def test_a_failing_authenticator_fails_closed_without_detail() -> None:
    def authenticate(credential: Credential) -> Principal | None:
        raise RuntimeError(f"jwks fetch failed for {credential.value} at 10.0.0.7")

    client = _app(create_router(authenticate=authenticate))
    response = client.get("/whoami", headers=_bearer())

    assert response.status_code == 503
    assert response.json() == {
        "detail": {"category": "unavailable", "message": "Authentication is unavailable."}
    }
    assert TOKEN not in response.text
    assert "10.0.0.7" not in response.text


@pytest.mark.parametrize(
    "returned", [{"subject": "alice"}, "alice", True, RequestAuth(principal=ALICE)]
)
def test_an_authenticator_returning_anything_but_a_principal_fails_closed(
    returned: object,
) -> None:
    client = _app(create_router(authenticate=lambda credential: returned))  # type: ignore[arg-type,return-value]

    response = client.get("/whoami", headers=_bearer())

    assert response.status_code == 500
    assert response.json()["detail"]["category"] == "internal"


def test_a_principal_without_a_tenant_is_tenant_free() -> None:
    authenticator = _Authenticator(Principal(subject="bot"))
    client = _app(create_router(authenticate=authenticator))

    assert client.get("/whoami", headers=_bearer()).json() == {"subject": "bot", "tenants": None}


def test_a_custom_tenant_resolver_decides_the_tenant() -> None:
    async def resolve(principal: Principal) -> Any:
        return tenant(f"org-of-{principal.subject}")

    client = _app(create_router(authenticate=_Authenticator(), resolve_tenant=resolve))

    assert client.get("/whoami", headers=_bearer()).json()["tenants"] == ["org-of-alice"]


@pytest.mark.parametrize("resolved", [all_tenants(), {"ids": ["acme"]}, "acme"])
def test_a_resolver_cannot_grant_anything_but_named_tenants(resolved: object) -> None:
    client = _app(
        create_router(authenticate=_Authenticator(), resolve_tenant=lambda principal: resolved)  # type: ignore[arg-type,return-value]
    )

    response = client.get("/whoami", headers=_bearer())

    assert response.status_code == 500
    assert response.json()["detail"]["category"] == "internal"


def test_a_failing_resolver_fails_closed() -> None:
    def resolve(principal: Principal) -> None:
        raise LookupError("tenant table unavailable")

    client = _app(create_router(authenticate=_Authenticator(), resolve_tenant=resolve))

    response = client.get("/whoami", headers=_bearer())
    assert response.status_code == 503
    assert "tenant table" not in response.text


# --- API key transport ----------------------------------------------------


def test_an_api_key_is_read_from_its_header_only() -> None:
    authenticator = _Authenticator()
    client = _app(create_router(authenticate=authenticator, credentials=api_key()))

    assert client.get("/whoami", headers=_bearer()).status_code == 401
    missing = client.get("/whoami")
    assert "www-authenticate" not in missing.headers
    assert client.get("/whoami", headers={"X-Api-Key": TOKEN}).status_code == 200
    assert [c.kind for c in authenticator.seen] == ["api-key"]


@pytest.mark.parametrize("value", ["has space", "tab\there", "é-unicode"])
def test_an_api_key_outside_visible_ascii_is_refused(value: str) -> None:
    authenticator = _Authenticator()
    client = _app(create_router(authenticate=authenticator, credentials=api_key()))

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
    ],
)
def test_auth_types_reject_invalid_values(build: Callable[[], object]) -> None:
    with pytest.raises(TypeError):
        build()


def test_create_router_validates_its_configuration() -> None:
    with pytest.raises(TypeError):
        create_router(authenticate="not callable")  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        create_router(authenticate=_Authenticator(), resolve_tenant="nope")  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        create_router(authenticate=_Authenticator(), credentials="bearer")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="header name"):
        bearer_token(header="Authorization: x")
