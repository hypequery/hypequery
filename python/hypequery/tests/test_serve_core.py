"""The framework-neutral serving core, driven through `Api.handle` with no server.

The shared HTTP fixtures already run against the core (see
`test_serve_http_fixtures.py` and `test_serve_semantic_fixtures.py`). These
tests pin the core's own pipeline: request ids, routing, authenticate-before-
body, the body policy over streamed bodies, cancellation on disconnect, and
strict client endpoints served without a web framework.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import pytest
from pydantic import BaseModel, TypeAdapter

from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQuery,
    Dataset,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.datasets.client import ResultScalar
from hypequery.serve import (
    Credential,
    EndpointPolicy,
    Principal,
    ServeError,
    bearer_token,
    default_tenant_resolver,
)
from hypequery.serve.core import Api, Call, Headers, QueryParams, ServeRequest, ServeResponse
from hypequery.serve.core.api import ApiHost
from hypequery.serve.core.authentication import Authentication
from hypequery.serve.core.client_contract import export_placements
from hypequery.serve.core.client_discovery import add_client_contract_route
from hypequery.serve.core.endpoints import DatasetEndpointCore, add_dataset_route
from hypequery.serve.core.errors import serve_error, validation_issues
from hypequery.serve.core.utils.json_body import MAX_BODY_DEPTH, BodyJsonError, parse_body_json

TOKEN = {"authorization": "Bearer reader"}


def authenticate(credential: Credential) -> Principal | None:
    if credential.value == "reader":
        return Principal(subject="alice", scopes=frozenset({"read"}))
    return None


def new_api(max_body_bytes: int = 1024) -> Api:
    return Api(
        authentication=Authentication(authenticate, bearer_token(), default_tenant_resolver),
        max_body_bytes=max_body_bytes,
    )


class Echo(BaseModel):
    value: int


async def echo(call: Call) -> ServeResponse:
    assert isinstance(call.input, Echo)
    return ServeResponse.json({"value": call.input.value, "caller": _caller(call)})


def _caller(call: Call) -> str | None:
    return call.auth.principal.subject if call.auth else None


def echo_api(max_body_bytes: int = 1024) -> Api:
    api = new_api(max_body_bytes)
    api.add_route("POST", "/echo", echo, input=TypeAdapter(Echo))
    api.add_route("POST", "/open", echo, input=TypeAdapter(Echo), public=True)
    return api


class NeverRead:
    """A streamed body that fails the test if the core reads it."""

    def __aiter__(self) -> AsyncIterator[bytes]:
        raise AssertionError("the body must not be read")


async def chunks(*parts: bytes) -> AsyncIterator[bytes]:
    for part in parts:
        yield part


def handle(api: Api, request: ServeRequest) -> tuple[ServeResponse, Any]:
    response = asyncio.run(api.handle(request))
    return response, json.loads(response.body) if response.body else None


def post(path: str, headers: dict[str, str], body: Any = b"") -> ServeRequest:
    return ServeRequest(method="POST", path=path, headers=Headers(headers.items()), body=body)


def json_post(path: str, value: object, headers: dict[str, str] | None = None) -> ServeRequest:
    body = json.dumps(value).encode()
    sent = {**TOKEN, **(headers or {})}
    sent.update({"content-type": "application/json", "content-length": str(len(body))})
    return post(path, sent, body)


# --- messages ----------------------------------------------------------------


def test_headers_are_lowercase_multi_valued_and_redacted_in_repr() -> None:
    headers = Headers([("Authorization", "Bearer secret"), ("X-A", "1"), ("x-a", "2")])
    assert headers.get("AUTHORIZATION") == "Bearer secret"
    assert headers.getlist("x-a") == ["1", "2"]
    assert "X-A" in headers
    assert 1 not in headers
    assert list(headers) == ["authorization", "x-a"]
    assert len(headers) == 3
    assert headers.get("missing", "fallback") == "fallback"
    assert "secret" not in repr(headers)
    query = QueryParams([("a", "1"), ("A", "2")])
    assert query.getlist("a") == ["1"]
    assert query.items() == (("a", "1"), ("A", "2"))
    assert "QueryParams" in repr(query)


def test_requests_take_core_mappings_and_responses_merge_headers() -> None:
    with pytest.raises(TypeError):
        ServeRequest(method="GET", path="/", headers={"a": "b"})  # type: ignore[arg-type]
    response = ServeResponse.json({"a": 1}, status=201, headers={"X-Test": "1"})
    assert response.status == 201
    assert response.body == b'{"a":1}'
    assert response.headers == {"x-test": "1", "content-type": "application/json"}
    assert response.with_headers({"X-Test": "2"}).headers["x-test"] == "2"
    assert "x-test" not in response.without_headers("X-Test").headers


# --- routing and request ids -------------------------------------------------


def test_unrouted_requests_are_not_found_whatever_the_method() -> None:
    api = echo_api()
    for method, path in (("GET", "/echo"), ("DELETE", "/echo"), ("GET", "/missing")):
        response, body = handle(api, ServeRequest(method=method, path=path))
        assert response.status == 404
        assert body["error"]["message"] == f"No endpoint registered for {method} {path}"
        assert response.headers["cache-control"] == "no-store"
    response, body = handle(api, ServeRequest(method="GET", path="/café"))
    assert body["error"]["message"] == "No endpoint registered for this request"


def test_every_response_carries_the_server_id_and_only_a_valid_correlation_id() -> None:
    async def sets_ids(call: Call) -> ServeResponse:
        return ServeResponse.json(
            {}, headers={"x-request-id": "handler", "x-correlation-id": "handler"}
        )

    api = new_api()
    api.add_route("GET", "/ids", sets_ids, public=True)
    response, _ = handle(
        api, ServeRequest(method="GET", path="/ids", headers=Headers([("x-request-id", "t-1")]))
    )
    assert response.headers["x-request-id"] not in ("handler", "t-1")
    assert len(response.headers["x-request-id"]) == 32
    assert response.headers["x-correlation-id"] == "t-1"
    for sent in ([("x-request-id", "bad id")], [("x-request-id", "a"), ("x-request-id", "b")]):
        response, _ = handle(api, ServeRequest(method="GET", path="/ids", headers=Headers(sent)))
        assert "x-correlation-id" not in response.headers


def test_route_registration_is_validated() -> None:
    api = new_api()
    with pytest.raises(ValueError, match="method"):
        api.add_route("TRACE", "/x", echo)
    with pytest.raises(ValueError, match="path"):
        api.add_route("GET", "x", echo)
    with pytest.raises(TypeError, match="public"):
        api.add_route("GET", "/x", echo, public=1)  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="Authentication"):
        Api(authentication=object())  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="max_body_bytes"):
        new_api(0)
    with pytest.raises(TypeError, match="mount"):
        Api(
            authentication=Authentication(authenticate, bearer_token(), default_tenant_resolver),
            client_mount_path=None,  # type: ignore[arg-type]
        )
    first = api.add_route("GET", "/x", echo)
    api.add_route("GET", "/x", echo)
    assert api.match("GET", "/x") is first
    assert api.routes[0] is first


# --- authenticate before body, then the body policy --------------------------


def test_an_unauthenticated_request_never_has_its_body_read() -> None:
    response, body = handle(
        echo_api(), post("/echo", {"content-type": "application/json"}, NeverRead())
    )
    assert response.status == 401
    assert body["error"]["details"] == {"reason": "missing_credentials"}
    assert response.headers["www-authenticate"] == "Bearer"


def test_public_routes_skip_authentication_and_no_store() -> None:
    response, body = handle(echo_api(), json_post("/open", {"value": 1}, {"authorization": ""}))
    assert response.status == 200
    assert body == {"value": 1, "caller": None}
    assert "cache-control" not in response.headers
    response, body = handle(echo_api(), json_post("/echo", {"value": 2}))
    assert body == {"value": 2, "caller": "alice"}
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    ("headers", "body", "status", "message"),
    [
        ({"content-length": "4096"}, NeverRead(), 413, "Request body exceeds"),
        ({"content-length": "1, 1"}, NeverRead(), 400, "invalid Content-Length"),
        ({"content-encoding": "gzip"}, NeverRead(), 415, "content-encoded"),
        ({"content-length": "2", "content-type": "text/plain"}, NeverRead(), 415, "application"),
        ({"transfer-encoding": "chunked"}, NeverRead(), 415, "application/json"),
        (
            {"content-length": "2", "content-type": "application/json; charset=latin-1"},
            NeverRead(),
            415,
            "UTF-8",
        ),
        # Without declared framing, the limit and media type apply as bytes arrive.
        ({"content-type": "application/json"}, chunks(b"[", b" " * 1100), 413, "exceeds"),
        ({}, chunks(b"", b"{}"), 415, "application/json"),
    ],
)
def test_body_policy_applies_before_and_while_the_body_is_read(
    headers: dict[str, str], body: Any, status: int, message: str
) -> None:
    response, error = handle(echo_api(), post("/echo", {**TOKEN, **headers}, body))
    assert response.status == status
    assert message in error["error"]["message"]


@pytest.mark.parametrize(
    ("body", "issues"),
    [
        (b"", [{"path": [], "message": "Field required", "code": "missing"}]),
        (b"null", [{"path": [], "message": "Field required", "code": "missing"}]),
        (b"{bad", [{"path": [1], "message": "JSON decode error", "code": "json_invalid"}]),
        (
            b'{"value": "x"}',
            [
                {
                    "path": ["value"],
                    "message": "Input should be a valid integer, unable to parse string as an "
                    "integer",
                    "code": "int_parsing",
                }
            ],
        ),
    ],
)
def test_input_errors_carry_fastapi_locations(body: bytes, issues: list[object]) -> None:
    headers = {**TOKEN, "content-type": "application/json", "content-length": str(len(body))}
    response, error = handle(echo_api(), post("/echo", headers, body))
    assert response.status == 400
    assert error["error"]["details"]["issues"] == issues


def test_an_undecodable_or_failing_body_is_a_parse_error() -> None:
    async def failing() -> AsyncIterator[bytes]:
        yield b"{"
        raise ConnectionResetError("peer went away")

    headers = {**TOKEN, "content-type": "application/json"}
    for body in (b"\x80", failing()):
        response, error = handle(echo_api(), post("/echo", headers, body))
        assert response.status == 400
        assert error["error"]["message"] == "There was an error parsing the body"


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        # A lone surrogate, which no UTF-8 encoder (so no driver) can send on.
        (b'{"value": "\\ud800"}', "a string is not valid Unicode"),
        (b'{"\\udfff": 1}', "a string is not valid Unicode"),
        # JSON.parse refuses these; Python's json would read them.
        (b'{"value": NaN}', "NaN is not JSON"),
        (b'{"value": -Infinity}', "-Infinity is not JSON"),
        # Validators walk a body recursively: past the limit is caller input,
        # not a server error with a thousand-frame traceback in the log.
        (b'{"value": ' + b"[" * 64 + b"]" * 64 + b"}", "nested too deeply"),
        (b"[" * 5_000 + b"]" * 5_000, "nested too deeply"),
    ],
    ids=["lone-surrogate", "lone-surrogate-key", "nan", "infinity", "deep", "deeper"],
)
def test_unusable_json_is_a_validation_error_not_a_server_error(
    body: bytes, reason: str, caplog: pytest.LogCaptureFixture
) -> None:
    headers = {**TOKEN, "content-type": "application/json"}
    response, error = handle(echo_api(max_body_bytes=1 << 20), post("/echo", headers, body))
    assert response.status == 400
    assert error["error"]["details"]["issues"] == [
        {"path": [], "message": f"JSON decode error: {reason}", "code": "json_invalid"}
    ]
    assert not caplog.records


def test_a_body_is_read_as_utf8_only() -> None:
    headers = {**TOKEN, "content-type": "application/json"}
    for body in ('{"value": 1}'.encode("utf-16"), '{"value": 1}'.encode("utf-32")):
        response, error = handle(echo_api(), post("/echo", headers, body))
        assert response.status == 400
        assert error["error"]["message"] == "There was an error parsing the body"


def test_json_nested_to_the_limit_is_accepted() -> None:
    nested = b"[" * MAX_BODY_DEPTH + b"]" * MAX_BODY_DEPTH
    assert parse_body_json(nested) is not None
    with pytest.raises(BodyJsonError):
        parse_body_json(b"[" + nested + b"]")
    # A surrogate pair is one character; only a lone surrogate is refused.
    assert parse_body_json(rb'{"caf\u00e9": "\ud83d\ude00"}') == {"caf\u00e9": "\U0001f600"}


# --- errors ----------------------------------------------------------------------


def test_core_errors_are_the_public_serve_error() -> None:
    error = serve_error(403, "FORBIDDEN", "Access denied")
    assert type(error) is ServeError
    with pytest.raises(ServeError) as raised:
        EndpointPolicy().authorize(None)
    assert raised.value.status_code == 401


def test_unexpected_errors_are_logged_with_the_request_id_and_never_shown(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def boom(call: Call) -> ServeResponse:
        raise RuntimeError("SECRET")

    api = new_api()
    api.add_route("GET", "/boom", boom, public=True)
    response, body = handle(api, ServeRequest(method="GET", path="/boom"))
    assert response.status == 500
    assert "SECRET" not in response.body.decode()
    assert body["error"]["message"] == "An unexpected error occurred"
    assert response.headers["x-request-id"] in caplog.records[-1].getMessage()


# --- dataset endpoints, cancellation and strict clients ----------------------------


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


def orders() -> Dataset:
    return Dataset(
        name="orders",
        source="private_orders",
        dimensions={"country": dimension.string()},
        measures={"total": measure.count("country")},
    )


class Executor:
    def execute(self, compiled: CompiledQuery) -> Rows:
        return Rows(("total",), ((3,),))


def test_a_disconnected_caller_cancels_its_query() -> None:
    started = threading.Event()

    class Waiting:
        def execute(self, compiled: CompiledQuery) -> Rows:
            started.set()
            assert compiled.cancellation is not None
            deadline = time.monotonic() + 5
            while not compiled.cancellation.is_set() and time.monotonic() < deadline:
                time.sleep(0.01)
            assert compiled.cancellation.is_set()
            return Rows(("total",), ((1,),))

    async def disconnected() -> None:
        # The caller goes once the query has started.
        while not started.is_set():
            await asyncio.sleep(0.01)

    api = new_api()
    add_dataset_route(
        api,
        "/orders",
        DatasetEndpointCore(dataset=orders(), client=create_dataset_client(executor=Waiting())),
    )
    request = json_post("/orders", {})
    request = ServeRequest(
        method=request.method,
        path=request.path,
        headers=request.headers,
        body=request.body,
        wait_disconnected=disconnected,
    )
    response, body = handle(api, request)
    assert response.status == 503
    assert body["error"]["message"] == "The request was cancelled."


def test_strict_client_endpoints_and_discovery_are_served_by_the_core() -> None:
    api = new_api()
    policy = EndpointPolicy(required_scopes=frozenset({"read"}))
    endpoint = DatasetEndpointCore(
        dataset=orders(),
        client=create_dataset_client(executor=Executor()),
        policy=policy,
        client_profile=ClientQueryProfile(),
    )
    add_dataset_route(api, "/orders", endpoint)
    add_client_contract_route(api)
    with pytest.raises(ValueError, match="unique"):
        add_dataset_route(api, "/orders", endpoint)
    host = ApiHost(api)
    built = export_placements(
        (api.client_endpoints,),
        host.placements((api.client_endpoints,)),
        production=None,
        mount_path=host.mount_path,
    )
    pin = built["contract"]["endpoints"][0]["schemaHash"]

    response, body = handle(api, json_post("/orders", {}, {"x-hypequery-client-schema": pin}))
    assert response.status == 200, body
    assert body == {"data": [{"total": "3"}]}
    response, body = handle(api, json_post("/orders", {}, {"x-hypequery-client-schema": "x"}))
    assert response.status == 409
    assert body["error"]["details"] == {"code": "CLIENT_SCHEMA_CHANGED"}
    response, body = handle(api, json_post("/orders", {"sql": "x"}))
    assert body["error"]["message"] == "Invalid client query."

    response, body = handle(
        api, ServeRequest(method="GET", path="/client-contract", headers=Headers(TOKEN.items()))
    )
    assert response.headers["vary"] == "authorization"
    assert [item["path"] for item in body["endpoints"]] == ["/orders"]
    response, body = handle(api, ServeRequest(method="GET", path="/client-contract"))
    assert response.status == 401


def test_a_client_path_already_served_by_post_is_refused() -> None:
    api = new_api()
    api.add_route("POST", "/orders", echo)
    with pytest.raises(ValueError, match="already registered"):
        add_dataset_route(
            api,
            "/orders",
            DatasetEndpointCore(
                dataset=orders(),
                client=create_dataset_client(executor=Executor()),
                client_profile=ClientQueryProfile(),
            ),
        )


def test_the_neutral_error_and_issue_paths() -> None:
    error = ServeError(
        429, "RATE_LIMITED", "Slow down", details={"retry": 1}, headers={"Retry-After": "1"}
    )
    assert (error.status_code, error.type, error.message) == (429, "RATE_LIMITED", "Slow down")
    assert error.details == {"retry": 1}
    assert error.headers == {"Retry-After": "1"}
    assert validation_issues([{"loc": "body", "msg": "m", "type": "t"}]) == [
        {"path": [], "message": "m", "code": "t"}
    ]


def _orders_api(authenticator: Any, path: str) -> Api:
    api = Api(authentication=Authentication(authenticator, bearer_token(), default_tenant_resolver))
    add_dataset_route(
        api,
        path,
        DatasetEndpointCore(
            dataset=orders(),
            client=create_dataset_client(executor=Executor()),
            client_profile=ClientQueryProfile(),
        ),
    )
    return api


def test_client_discovery_fails_closed_when_a_target_cannot_be_checked_or_exported() -> None:
    def broken(credential: Credential) -> Principal:
        raise RuntimeError("auth backend down")

    main = _orders_api(authenticate, "/orders")
    unavailable = _orders_api(broken, "/elsewhere")
    add_client_contract_route(main, sources=(main.client_endpoints, unavailable.client_endpoints))
    response, body = handle(
        main, ServeRequest(method="GET", path="/client-contract", headers=Headers(TOKEN.items()))
    )
    assert response.status == 503
    assert body["error"]["message"] == "Authentication is unavailable."

    # The same endpoint id at two paths cannot form one contract.
    duplicate = _orders_api(authenticate, "/again")
    add_client_contract_route(
        duplicate,
        "/both",
        sources=(main.client_endpoints, duplicate.client_endpoints),
    )
    response, body = handle(
        duplicate, ServeRequest(method="GET", path="/both", headers=Headers(TOKEN.items()))
    )
    assert response.status == 503
    assert body["error"]["message"] == "Client discovery is unavailable."
