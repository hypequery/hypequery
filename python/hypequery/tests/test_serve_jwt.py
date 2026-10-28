"""`jwt_strategy` and `analytics_token_issuer`: options, claims, key sets.

The cross-language behaviour (which tokens are accepted and refused) is pinned
by `test_serve_jwt_fixtures.py`. These tests cover what the shared fixtures
cannot: configuration, the clock, key-set caching and fetch failures.
"""

from __future__ import annotations

import asyncio
import base64
import http.client
import ipaddress
import socket
import ssl
import threading
import time
import warnings
from collections.abc import Iterator, Mapping
from concurrent.futures import Future
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import jwt
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from asgi_client import AsgiClient
from core_transport import CoreClient
from hypequery.serve import (
    Credential,
    InvalidCredential,
    JwtStrategy,
    Principal,
    analytics_token_issuer,
    bearer_token,
    create_api,
    jwt_strategy,
    openapi_document,
    to_asgi_app,
)
from hypequery.serve.core import Api, Call, ServeResponse, jwks, jwt_auth
from hypequery.serve.core.jwks import JwksUnavailable, RemoteJwks, fetch_jwks
from hypequery.serve.core.utils.http_deadline import Deadline
from hypequery.serve.core.utils.http_proxy import with_default_ports
from hypequery.serve.core.utils.jwk_selection import matching_keys
from jwks_server import JwksServer

SECRET = "a-shared-secret-of-at-least-thirty-two-bytes"  # noqa: S105 - a test secret
NOW = 1_800_000_000


def _private_key(bits: int = 2048) -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=bits)


RSA_1 = _private_key()
RSA_2 = _private_key()


def _jwk(key: rsa.RSAPrivateKey, kid: str, **members: Any) -> dict[str, Any]:
    public: dict[str, Any] = jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    return {**public, "kid": kid, "use": "sig", **members}


def _hs(claims: Mapping[str, Any], secret: str = SECRET, **headers: Any) -> str:
    return jwt.encode(dict(claims), secret, algorithm="HS256", headers=headers or None)


def _rs(claims: Mapping[str, Any], key: rsa.RSAPrivateKey = RSA_1, kid: str = "rsa-1") -> str:
    return jwt.encode(dict(claims), key, algorithm="RS256", headers={"kid": kid})


def _verify(strategy: JwtStrategy, token: str) -> Principal | None:
    return asyncio.run(strategy(Credential("bearer", token)))


@pytest.fixture(autouse=True)
def _frozen_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jwt_auth, "_clock", lambda: NOW)


@pytest.fixture
def server() -> Iterator[JwksServer]:
    with JwksServer({"keys": [_jwk(RSA_1, "rsa-1", alg="RS256")]}) as running:
        yield running


def _whoami_api(strategy: JwtStrategy) -> Api:
    async def whoami(call: Call) -> ServeResponse:
        assert call.auth is not None
        return ServeResponse.json({"subject": call.auth.principal.subject})

    api = create_api(auth=strategy)
    api.add_route("GET", "/whoami", whoami)
    return api


def _core(strategy: JwtStrategy) -> CoreClient:
    return CoreClient(_whoami_api(strategy))


def _get(client: CoreClient, token: str) -> Any:
    return client.request("GET", "/whoami", headers={"Authorization": f"Bearer {token}"})


# Options -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("options", "message"),
    [
        ({}, "exactly one"),
        ({"secret": SECRET, "jwks_url": "https://idp.example.com/jwks"}, "exactly one"),
        ({"secret": ""}, "must not be empty"),
        ({"secret": b"short"}, "at least 32 bytes"),
        ({"secret": SECRET, "algorithms": ["HS512"]}, "at least 64 bytes"),
        ({"secret": SECRET, "algorithms": ["RS256"]}, "HS256, HS384 or HS512"),
        ({"secret": SECRET, "algorithms": ["none"]}, "HS256, HS384 or HS512"),
        ({"secret": SECRET, "algorithms": []}, "non-empty"),
        ({"secret": SECRET, "issuer": ""}, "issuer"),
        ({"secret": SECRET, "audience": []}, "audience"),
        ({"secret": SECRET, "leeway": -1}, "leeway"),
        ({"jwks_url": "https://idp.example.com/jwks", "algorithms": ["HS256"]}, "key set"),
        ({"jwks_url": "https://idp.example.com/jwks", "algorithms": ["none"]}, "key set"),
        ({"jwks_url": "   "}, "must not be empty"),
        ({"jwks_url": "file:///etc/jwks.json"}, r"http\(s\) URL"),
        ({"jwks_url": "http://idp.example.com/jwks"}, "https outside localhost"),
        ({"jwks_url": "https://idp.example.com/jwks", "jwks_timeout": 0}, "jwks_timeout"),
    ],
)
def test_strategy_refuses_unsafe_options(options: dict[str, Any], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        jwt_strategy(**options)


@pytest.mark.parametrize(
    ("options", "message"),
    [
        ({"secret": 123}, "str or bytes"),
        ({"secret": SECRET, "algorithms": "HS256"}, "not a string"),
        ({"secret": SECRET, "map_claims": "sub"}, "callable"),
        ({"secret": SECRET, "leeway": "5"}, "timedelta or a number"),
        ({"secret": SECRET, "leeway": True}, "timedelta or a number"),
    ],
)
def test_strategy_refuses_wrong_option_types(options: dict[str, Any], message: str) -> None:
    with pytest.raises(TypeError, match=message):
        jwt_strategy(**options)


def test_loopback_key_sets_may_use_http() -> None:
    for host in ("localhost", "127.0.0.1", "[::1]"):
        strategy = jwt_strategy(jwks_url=f"http://{host}:8000/jwks.json")
        assert strategy.jwks_url == f"http://{host}:8000/jwks.json"
    assert jwt_strategy(secret=SECRET).jwks_url is None


# Claims and the clock ------------------------------------------------------


def test_expiry_is_exclusive_and_leeway_extends_it() -> None:
    strict = jwt_strategy(secret=SECRET)
    lenient = jwt_strategy(secret=SECRET, leeway=timedelta(seconds=30))

    assert _verify(strict, _hs({"sub": "u", "exp": NOW + 1})) is not None
    with pytest.raises(InvalidCredential):
        _verify(strict, _hs({"sub": "u", "exp": NOW}))
    assert _verify(lenient, _hs({"sub": "u", "exp": NOW - 29})) is not None
    with pytest.raises(InvalidCredential):
        _verify(lenient, _hs({"sub": "u", "exp": NOW - 30}))


def test_not_before_honours_leeway() -> None:
    token = _hs({"sub": "u", "nbf": NOW + 10})
    with pytest.raises(InvalidCredential):
        _verify(jwt_strategy(secret=SECRET), token)
    assert _verify(jwt_strategy(secret=SECRET, leeway=10), token) is not None


@pytest.mark.parametrize(
    "claims",
    [
        {"roles": ["admin"]},
        {"sub": ""},
        {"sub": 42},
        {"sub": "u", "org_id": ""},
    ],
)
def test_default_mapping_refuses_tokens_a_principal_cannot_hold(claims: dict[str, Any]) -> None:
    assert _verify(jwt_strategy(secret=SECRET), _hs(claims)) is None


def test_hs384_and_hs512_verify_with_long_enough_secrets() -> None:
    secret = "s" * 64
    strategy = jwt_strategy(secret=secret.encode(), algorithms=["HS384", "HS512"])
    for algorithm in ("HS384", "HS512"):
        token = jwt.encode({"sub": "u"}, secret, algorithm=algorithm)
        assert _verify(strategy, token) == Principal(subject="u")
    with pytest.raises(InvalidCredential):
        _verify(strategy, _hs({"sub": "u"}, secret))


def test_custom_mappers_see_read_only_claims() -> None:
    seen: list[Mapping[str, Any]] = []

    def to_principal(claims: Mapping[str, Any]) -> Principal | None:
        seen.append(claims)
        return Principal(subject=claims["email"]) if claims.get("email") else None

    async def to_principal_async(claims: Mapping[str, Any]) -> Principal | None:
        return Principal(subject=claims["sub"], tenant_id=claims["org"])

    sync_strategy = jwt_strategy(secret=SECRET, map_claims=to_principal)
    assert _verify(sync_strategy, _hs({"email": "a@example.com"})) == Principal("a@example.com")
    assert _verify(sync_strategy, _hs({"sub": "no-email"})) is None
    with pytest.raises(TypeError):
        seen[0]["email"] = "b@example.com"  # type: ignore[index]

    async_strategy = jwt_strategy(secret=SECRET, map_claims=to_principal_async)
    assert _verify(async_strategy, _hs({"sub": "u", "org": "acme"})) == Principal(
        subject="u", tenant_id="acme"
    )


def test_through_the_core_a_refusal_is_401_and_a_failing_mapper_503() -> None:
    def broken(claims: Mapping[str, Any]) -> Principal:
        raise RuntimeError("mapper bug")

    accepted = _get(_core(jwt_strategy(secret=SECRET)), _hs({"sub": "alice"}))
    assert accepted.status_code == 200
    assert accepted.json() == {"subject": "alice"}

    refused = _get(_core(jwt_strategy(secret=SECRET)), _hs({"sub": "alice"}, "x" * 40))
    assert refused.status_code == 401
    assert refused.headers["www-authenticate"] == "Bearer"
    assert refused.json()["error"]["details"]["reason"] == "invalid_credentials"

    failing = _get(_core(jwt_strategy(secret=SECRET, map_claims=broken)), _hs({"sub": "alice"}))
    assert failing.status_code == 503


def test_serves_through_create_api_and_to_asgi_app() -> None:
    issue = analytics_token_issuer(SECRET, audience="analytics")

    def to_principal(claims: Mapping[str, Any]) -> Principal:
        return Principal(subject=claims["sub"], tenant_id=claims.get("org_id"))

    for strategy in (
        jwt_strategy(secret=SECRET, audience="analytics"),
        jwt_strategy(secret=SECRET, audience="analytics", map_claims=to_principal),
    ):
        client = AsgiClient(to_asgi_app(_whoami_api(strategy)))
        token = issue("alice", tenant_id="acme")
        response = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert response.json() == {"subject": "alice"}
        missing = client.get("/whoami")
        assert missing.status_code == 401
        assert missing.json()["error"]["details"]["reason"] == "missing_credentials"


def test_openapi_describes_a_jwt_bearer_credential() -> None:
    def opaque(credential: Credential) -> Principal | None:
        return None

    def scheme(api: Api) -> Any:
        components: Any = openapi_document(api)["components"]
        return components["securitySchemes"]["credential"]

    assert scheme(_whoami_api(jwt_strategy(secret=SECRET))) == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }
    assert scheme(create_api(auth=opaque)) == {"type": "http", "scheme": "bearer"}
    custom_header = create_api(
        auth=jwt_strategy(secret=SECRET), credentials=bearer_token(header="x-token")
    )
    assert scheme(custom_header) == {"type": "apiKey", "in": "header", "name": "x-token"}


# The issuer ----------------------------------------------------------------


def test_issuer_claims_and_lifetime() -> None:
    issue = analytics_token_issuer(
        SECRET.encode(), expires_in=timedelta(hours=1), issuer="https://app", audience="api"
    )
    token = issue("alice", tenant_id="acme", roles=("admin", "analyst"))
    claims = _decode(token, audience="api")
    assert claims == {
        "org_id": "acme",
        "roles": ["admin", "analyst"],
        "sub": "alice",
        "iat": NOW,
        "exp": NOW + 3600,
        "iss": "https://app",
        "aud": "api",
    }
    bare = _decode(issue_default())
    assert bare == {"sub": "bob", "iat": NOW, "exp": NOW + 900}
    assert "<redacted>" in repr(issue)
    assert SECRET not in repr(issue)


def _decode(token: str, **options: Any) -> dict[str, Any]:
    # The tokens were issued at the frozen clock, not now.
    claims: dict[str, Any] = jwt.decode(
        token,
        SECRET,
        algorithms=["HS256"],
        options={"verify_exp": False, "verify_iat": False},
        **options,
    )
    return claims


def issue_default() -> str:
    return analytics_token_issuer(SECRET)("bob")


def test_issuer_tokens_verify_with_the_matching_strategy() -> None:
    issue = analytics_token_issuer("k" * 48, algorithm="HS384", issuer="i", audience="a")
    strategy = jwt_strategy(secret="k" * 48, algorithms=["HS384"], issuer="i", audience="a")
    principal = _verify(strategy, issue("alice", tenant_id="acme", roles=["admin"]))
    assert principal == Principal(subject="alice", roles=frozenset({"admin"}), tenant_id="acme")


@pytest.mark.parametrize(
    ("options", "error", "message"),
    [
        ({"secret": "short"}, ValueError, "at least 32 bytes"),
        ({"secret": SECRET, "algorithm": "RS256"}, ValueError, "HS256, HS384 or HS512"),
        ({"secret": SECRET, "expires_in": 0}, ValueError, "expires_in"),
        ({"secret": SECRET, "issuer": ""}, ValueError, "issuer"),
        ({"secret": SECRET, "audience": ["a"]}, ValueError, "audience"),
        ({"secret": None}, TypeError, "str or bytes"),
    ],
)
def test_issuer_refuses_unsafe_options(
    options: dict[str, Any], error: type[Exception], message: str
) -> None:
    with pytest.raises(error, match=message):
        analytics_token_issuer(**options)


@pytest.mark.parametrize(
    ("call", "error"),
    [
        ({"subject": ""}, ValueError),
        ({"subject": "u", "tenant_id": ""}, ValueError),
        ({"subject": "u", "roles": "admin"}, TypeError),
        ({"subject": "u", "roles": ["admin", 1]}, TypeError),
    ],
)
def test_issuer_refuses_claims_a_principal_cannot_hold(
    call: dict[str, Any], error: type[Exception]
) -> None:
    issue = analytics_token_issuer(SECRET)
    with pytest.raises(error):
        issue(**call)


# Key sets ------------------------------------------------------------------


def test_key_set_is_fetched_once_and_shared_across_event_loops(server: JwksServer) -> None:
    strategy = jwt_strategy(jwks_url=server.url)
    for subject in ("a", "b", "c"):
        # Each asyncio.run is a new event loop.
        assert _verify(strategy, _rs({"sub": subject})) == Principal(subject=subject)
    assert server.hits == 1


def test_concurrent_requests_share_one_fetch(server: JwksServer) -> None:
    server.delay = 0.2
    strategy = jwt_strategy(jwks_url=server.url)

    async def verify_many() -> list[Principal | None]:
        token = _rs({"sub": "u"})
        return await asyncio.gather(*(strategy(Credential("bearer", token)) for _ in range(8)))

    assert asyncio.run(verify_many()) == [Principal(subject="u")] * 8
    assert server.hits == 1


def test_stale_key_set_is_refetched(server: JwksServer, monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr(jwks, "_monotonic", lambda: clock[0])
    strategy = jwt_strategy(jwks_url=server.url, jwks_cache_max_age=60)

    _verify(strategy, _rs({"sub": "u"}))
    clock[0] += 59
    _verify(strategy, _rs({"sub": "u"}))
    assert server.hits == 1
    clock[0] += 1
    _verify(strategy, _rs({"sub": "u"}))
    assert server.hits == 2


def test_unknown_kid_refetches_once_per_cooldown(
    server: JwksServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1000.0]
    monkeypatch.setattr(jwks, "_monotonic", lambda: clock[0])
    strategy = jwt_strategy(jwks_url=server.url, jwks_cooldown=30)
    _verify(strategy, _rs({"sub": "u"}))
    # The provider rotates in a new key.
    server.document = {"keys": [_jwk(RSA_1, "rsa-1"), _jwk(RSA_2, "rsa-2")]}
    rotated = _rs({"sub": "u"}, RSA_2, "rsa-2")

    with pytest.raises(InvalidCredential):
        _verify(strategy, rotated)
    assert server.hits == 1  # cooling down: no refetch

    clock[0] += 30
    assert _verify(strategy, rotated) == Principal(subject="u")
    assert server.hits == 2
    with pytest.raises(InvalidCredential):
        _verify(strategy, _rs({"sub": "u"}, kid="made-up"))
    assert server.hits == 2


def _redirect(server: JwksServer) -> None:
    server.status = 302
    server.headers["location"] = "https://a.example/jwks.json"


@pytest.mark.parametrize(
    "configure",
    [
        pytest.param(lambda s: setattr(s, "status", 500), id="server-error"),
        pytest.param(lambda s: setattr(s, "status", 203), id="non-200-success"),
        pytest.param(_redirect, id="redirect"),
        pytest.param(lambda s: setattr(s, "body", b"{not json"), id="not-json"),
        pytest.param(lambda s: setattr(s, "body", b'{"keys":[{"kty":NaN}]}'), id="nan"),
        pytest.param(lambda s: setattr(s, "document", {"keys": {}}), id="keys-not-a-list"),
        pytest.param(lambda s: setattr(s, "document", ["x"]), id="not-an-object"),
        pytest.param(lambda s: setattr(s, "document", {"keys": ["x"]}), id="key-not-an-object"),
        pytest.param(
            lambda s: setattr(s, "body", b'{"keys":[],"pad":"' + b"x" * 600_000 + b'"}'),
            id="too-large",
        ),
        pytest.param(lambda s: setattr(s, "delay", 0.5), id="timeout"),
    ],
)
def test_an_unusable_key_set_answers_503_not_401(server: JwksServer, configure: Any) -> None:
    configure(server)
    strategy = jwt_strategy(jwks_url=server.url, jwks_timeout=0.1)
    with pytest.raises(JwksUnavailable):
        _verify(strategy, _rs({"sub": "u"}))
    assert _get(_core(strategy), _rs({"sub": "u"})).status_code == 503


def test_an_unreachable_key_set_answers_503() -> None:
    strategy = jwt_strategy(jwks_url="http://127.0.0.1:9/jwks.json", jwks_timeout=0.5)
    assert _get(_core(strategy), _rs({"sub": "u"})).status_code == 503


def test_a_dripping_key_set_is_cut_off_at_the_timeout(server: JwksServer) -> None:
    # One byte every 20 ms never trips a per-read socket timeout; the whole
    # fetch must still end by the timeout.
    server.drip = 0.02
    started = time.monotonic()
    with pytest.raises(JwksUnavailable, match="too long"):
        fetch_jwks(server.url, 0.3)
    assert time.monotonic() - started < 1.5

    strategy = jwt_strategy(jwks_url=server.url, jwks_timeout=0.3)
    started = time.monotonic()
    assert _get(_core(strategy), _rs({"sub": "u"})).status_code == 503
    assert time.monotonic() - started < 1.5


@pytest.fixture
def tls_server(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[JwksServer]:
    """A key set over TLS on 127.0.0.1, with a self-signed certificate the fetch trusts."""

    key = _private_key()
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "127.0.0.1")])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(hours=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]),
            critical=False,
        )
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    pem = certificate.public_bytes(serialization.Encoding.PEM)
    (tmp_path / "cert.pem").write_bytes(pem)
    (tmp_path / "key.pem").write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.load_cert_chain(tmp_path / "cert.pem", tmp_path / "key.pem")

    def trusting() -> ssl.SSLContext:
        return ssl.create_default_context(cadata=pem.decode())

    monkeypatch.setattr(ssl, "_create_default_https_context", trusting)
    with JwksServer({"keys": [_jwk(RSA_1, "rsa-1", alg="RS256")]}, tls=server_context) as running:
        yield running


def test_an_https_key_set_is_fetched_with_its_certificate_checked(
    tls_server: JwksServer,
) -> None:
    assert tls_server.url.startswith("https://")
    assert fetch_jwks(tls_server.url, 5) == tls_server.document["keys"]


@pytest.mark.parametrize("phase", ["body", "headers"])
def test_a_dripping_https_key_set_is_cut_off_at_the_timeout(
    tls_server: JwksServer, phase: str
) -> None:
    if phase == "body":
        tls_server.drip = 0.02
    else:
        tls_server.drip_headers = 0.02
    # Run where a regression fails the test instead of hanging the suite.
    outcome: list[BaseException] = []

    def fetch() -> None:
        try:
            fetch_jwks(tls_server.url, 0.3)
        except BaseException as exc:
            outcome.append(exc)

    worker = threading.Thread(target=fetch, daemon=True)
    worker.start()
    worker.join(1.5)
    assert not worker.is_alive(), "the HTTPS fetch outlived its deadline"
    assert isinstance(outcome[0], JwksUnavailable)
    assert "too long" in str(outcome[0])

    strategy = jwt_strategy(jwks_url=tls_server.url, jwks_timeout=0.3)
    started = time.monotonic()
    assert _get(_core(strategy), _rs({"sub": "u"})).status_code == 503
    assert time.monotonic() - started < 1.5


def test_dripping_headers_are_cut_off_at_the_timeout(server: JwksServer) -> None:
    # The status line arrives, then a header one byte at a time: every
    # receive returns inside the socket timeout, but the request must not.
    server.drip_headers = 0.02
    started = time.monotonic()
    with pytest.raises(JwksUnavailable, match="too long"):
        fetch_jwks(server.url, 0.3)
    assert time.monotonic() - started < 1.5


def test_a_deadline_reaches_a_socket_tls_has_taken_over() -> None:
    # Wrapping a socket in TLS detaches the original object; the deadline
    # must still end the connection the wrapper now owns.
    near, far = socket.socketpair()
    with far, Deadline(0.05) as deadline:
        deadline.track(near)
        taken_over = socket.socket(fileno=near.detach())
        with taken_over:
            taken_over.settimeout(5)
            started = time.monotonic()
            assert taken_over.recv(1) == b""
            assert time.monotonic() - started < 1
    assert deadline.expired


def test_a_deadline_shuts_late_sockets_at_once() -> None:
    deadline = Deadline(0.01)
    with deadline:
        time.sleep(0.1)
    assert deadline.expired
    late = socket.socket()
    with pytest.raises(TimeoutError):
        deadline.track(late)
    assert late.fileno() == -1


def test_a_body_without_a_length_ends_with_the_connection(server: JwksServer) -> None:
    server.length = False
    assert fetch_jwks(server.url, 5) == server.document["keys"]


def test_the_key_set_url_query_is_sent(server: JwksServer) -> None:
    assert fetch_jwks(f"{server.url}?v=2", 5) == server.document["keys"]
    assert server.paths == ["/jwks.json?v=2"]


def test_https_key_sets_need_a_tls_server(server: JwksServer) -> None:
    with pytest.raises(JwksUnavailable, match="could not be fetched"):
        fetch_jwks(server.url.replace("http://", "https://"), 2)


SMALL_RSA = _private_key(1024)


@pytest.mark.parametrize(
    ("key", "signer"),
    [
        pytest.param({**_jwk(RSA_1, "rsa-1"), "d": "private"}, RSA_1, id="private-material"),
        pytest.param({**_jwk(RSA_1, "rsa-1"), "n": "!!"}, RSA_1, id="malformed-key"),
        pytest.param(_jwk(SMALL_RSA, "rsa-1"), SMALL_RSA, id="rsa-under-2048-bits"),
        pytest.param(_jwk(RSA_1, "rsa-1", use="enc"), RSA_1, id="encryption-key"),
        pytest.param(_jwk(RSA_1, "rsa-1", key_ops=["encrypt"]), RSA_1, id="no-verify-op"),
    ],
)
def test_unusable_keys_refuse_the_token(
    server: JwksServer, key: dict[str, Any], signer: rsa.RSAPrivateKey
) -> None:
    server.document = {"keys": [key]}
    with warnings.catch_warnings():
        # PyJWT warns about signing with the deliberately small key.
        warnings.simplefilter("ignore", jwt.warnings.InsecureKeyLengthWarning)
        token = _rs({"sub": "u"}, signer)
    with pytest.raises(InvalidCredential):
        _verify(jwt_strategy(jwks_url=server.url), token)


def test_imported_keys_are_reused(server: JwksServer) -> None:
    strategy = jwt_strategy(jwks_url=server.url)
    _verify(strategy, _rs({"sub": "u"}))
    imported = dict(strategy._imported)
    _verify(strategy, _rs({"sub": "v"}))
    assert strategy._imported == imported


@pytest.fixture
def no_environment_proxies(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in ("http_proxy", "https_proxy", "no_proxy", "all_proxy"):
        monkeypatch.delenv(name, raising=False)
        monkeypatch.delenv(name.upper(), raising=False)
    return monkeypatch


def test_plain_http_key_sets_go_through_the_configured_proxy(
    server: JwksServer, no_environment_proxies: pytest.MonkeyPatch
) -> None:
    proxy = server.url.removesuffix("/jwks.json").replace("http://", "http://ops:p%40ss@")
    no_environment_proxies.setenv("http_proxy", proxy)

    assert fetch_jwks("http://keys.example.test/jwks.json", 5) == server.document["keys"]
    # An HTTP proxy is sent the absolute URL, with the proxy's credentials.
    assert server.paths == ["http://keys.example.test/jwks.json"]
    assert server.proxy_authorizations == ["Basic " + base64.b64encode(b"ops:p@ss").decode()]


def test_https_key_sets_tunnel_through_the_configured_proxy(
    server: JwksServer, no_environment_proxies: pytest.MonkeyPatch
) -> None:
    proxy = server.url.removesuffix("/jwks.json").replace("http://", "http://ops:pw@")
    no_environment_proxies.setenv("https_proxy", proxy)

    # The test proxy opens the tunnel but speaks no TLS through it.
    with pytest.raises(JwksUnavailable, match="could not be fetched"):
        fetch_jwks("https://keys.example.test/.well-known/jwks.json", 2)
    assert server.paths == ["keys.example.test:443"]
    assert server.proxy_authorizations == ["Basic " + base64.b64encode(b"ops:pw").decode()]


def test_loopback_hosts_are_reached_directly(
    server: JwksServer, no_environment_proxies: pytest.MonkeyPatch
) -> None:
    # A proxy that would refuse every connection.
    no_environment_proxies.setenv("http_proxy", "http://127.0.0.1:9")
    assert fetch_jwks(server.url, 5) == server.document["keys"]


@pytest.mark.parametrize(
    ("no_proxy", "proxied"),
    [("keys.example.test:8443", False), ("keys.example.test:9443", True)],
)
def test_no_proxy_matches_the_host_and_port(
    server: JwksServer,
    no_environment_proxies: pytest.MonkeyPatch,
    no_proxy: str,
    proxied: bool,
) -> None:
    no_environment_proxies.setenv("http_proxy", server.url.removesuffix("/jwks.json"))
    no_environment_proxies.setenv("no_proxy", no_proxy)
    url = "http://keys.example.test:8443/jwks.json"
    if proxied:
        assert fetch_jwks(url, 5) == server.document["keys"]
        assert server.paths == [url]
    else:
        # Reached directly, so the made-up host does not resolve.
        with pytest.raises(JwksUnavailable):
            fetch_jwks(url, 5)
        assert server.paths == []


def test_a_no_proxy_list_with_ports_does_not_break_fetching(
    server: JwksServer, no_environment_proxies: pytest.MonkeyPatch
) -> None:
    no_environment_proxies.setenv("http_proxy", server.url.removesuffix("/jwks.json"))
    no_environment_proxies.setenv("no_proxy", "idp.internal:8443,localhost")
    url = "http://keys.example.test/jwks.json"
    assert fetch_jwks(url, 5) == server.document["keys"]
    assert server.paths == [url]
    assert with_default_ports({"no": "idp.internal:8443,localhost"}) == {
        "no": "idp.internal:8443,localhost"
    }


def test_proxies_get_their_own_scheme_default_port() -> None:
    assert with_default_ports(
        {
            "https": "http://proxy.internal",
            "http": "proxy.internal",
            "ftp": "http://ops:pw@proxy.internal:3128",
            "all": "https://secure-proxy.internal",
        }
    ) == {
        "https": "http://proxy.internal:80",
        "http": "http://proxy.internal:80",
        "ftp": "http://ops:pw@proxy.internal:3128",
        "all": "https://secure-proxy.internal:443",
    }
    assert with_default_ports({"https": "socks5://proxy.internal"}) == {
        "https": "socks5://proxy.internal"
    }
    assert with_default_ports({"https": "http://proxy.internal:bad"}) == {
        "https": "http://proxy.internal:bad"
    }


def test_a_port_less_proxy_is_dialled_on_port_80(
    no_environment_proxies: pytest.MonkeyPatch, monkeypatch: pytest.MonkeyPatch
) -> None:
    dialled: list[tuple[str, int]] = []

    def refuse(address: tuple[str, int], *args: object, **kwargs: object) -> socket.socket:
        dialled.append(address)
        raise ConnectionRefusedError

    monkeypatch.setattr(socket, "create_connection", refuse)
    no_environment_proxies.setenv("https_proxy", "http://proxy.internal")
    with pytest.raises(JwksUnavailable):
        fetch_jwks("https://idp.example.com/jwks.json", 2)
    assert dialled == [("proxy.internal", 80)]


def test_a_refused_response_is_closed(server: JwksServer, monkeypatch: pytest.MonkeyPatch) -> None:
    responses: list[http.client.HTTPResponse] = []
    original = http.client.HTTPConnection.getresponse

    def recording(self: http.client.HTTPConnection) -> http.client.HTTPResponse:
        response = original(self)
        responses.append(response)
        return response

    monkeypatch.setattr(http.client.HTTPConnection, "getresponse", recording)
    server.status = 500
    with pytest.raises(JwksUnavailable, match="answered 500"):
        fetch_jwks(server.url, 5)
    assert responses
    assert responses[0].isclosed()


def _never_finishing(monkeypatch: pytest.MonkeyPatch) -> list[object]:
    started: list[object] = []
    monkeypatch.setattr(RemoteJwks, "_fetch", lambda self, pending: started.append(pending))
    return started


def test_requests_join_the_fetch_in_flight_until_its_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = [0.0]
    monkeypatch.setattr(jwks, "_monotonic", lambda: clock[0])
    started = _never_finishing(monkeypatch)
    remote = RemoteJwks("https://idp.example.com/jwks", timeout=1, cache_max_age=60, cooldown=30)

    first, deadline = remote._start()
    assert deadline == 1.0
    clock[0] = 0.9
    assert remote._start() == (first, 1.0)
    # Past its deadline the fetch is abandoned; the next request starts anew.
    clock[0] = 1.0
    second, deadline = remote._start()
    assert second is not first
    assert deadline == 2.0
    assert len(started) == 2


def test_stuck_fetches_are_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [0.0]
    monkeypatch.setattr(jwks, "_monotonic", lambda: clock[0])
    started = _never_finishing(monkeypatch)
    remote = RemoteJwks("https://idp.example.com/jwks", timeout=1, cache_max_age=60, cooldown=30)
    for _ in range(jwks.MAX_STUCK_FETCHES):
        remote._start()
        clock[0] += 1
    with pytest.raises(JwksUnavailable, match="not ended"):
        remote._start()
    assert len(started) == jwks.MAX_STUCK_FETCHES


def test_a_waiter_never_waits_past_the_fetch_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    _never_finishing(monkeypatch)
    remote = RemoteJwks("https://idp.example.com/jwks", timeout=0.4, cache_max_age=60, cooldown=0)

    async def late_joiner() -> float:
        first = asyncio.ensure_future(remote.reload())
        await asyncio.sleep(0.2)
        joined = time.monotonic()
        with pytest.raises(JwksUnavailable, match="too long"):
            await remote.reload()
        with pytest.raises(JwksUnavailable):
            await first
        return time.monotonic() - joined

    # The joiner waits for what the fetch had left, about 0.2 s, not 0.4 s.
    assert asyncio.run(late_joiner()) < 0.35


def test_an_abandoned_fetch_that_succeeds_still_stores_its_keys() -> None:
    remote = RemoteJwks("https://idp.example.com/jwks", timeout=1, cache_max_age=60, cooldown=0)
    current: Future[list[dict[str, Any]]] = Future()
    remote._pending = current
    remote._fetching = 2
    remote._finished(Future(), [{"kty": "RSA"}])
    assert remote._pending is current
    assert remote._keys == [{"kty": "RSA"}]
    assert remote._fetching == 1


def test_key_selection_follows_jose() -> None:
    ec = {"kty": "EC", "crv": "P-256", "kid": "ec"}
    rsa_any = {"kty": "RSA", "kid": "r1"}
    rsa_ps = {"kty": "RSA", "kid": "r2", "alg": "PS256"}
    okp = {"kty": "OKP", "crv": "Ed448", "kid": "ed"}
    keys = [ec, rsa_any, rsa_ps, okp]

    assert matching_keys(keys, "RS256", None) == [rsa_any]
    assert matching_keys(keys, "PS256", None) == [rsa_any, rsa_ps]
    assert matching_keys(keys, "PS256", "r2") == [rsa_ps]
    assert matching_keys(keys, "ES256", None) == [ec]
    assert matching_keys(keys, "ES384", None) == []
    assert matching_keys(keys, "EdDSA", None) == [okp]
    assert matching_keys(keys, "HS256", None) == []


# Optional dependency -------------------------------------------------------


def test_key_sets_need_cryptography(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jwt.algorithms, "has_crypto", False)
    with pytest.raises(ModuleNotFoundError, match="cryptography"):
        jwt_strategy(jwks_url="https://idp.example.com/jwks")
    assert jwt_strategy(secret=SECRET) is not None


def test_a_fetch_that_never_finishes_times_out_the_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(RemoteJwks, "_fetch", lambda self, pending: None)
    remote = RemoteJwks("https://idp.example.com/jwks", timeout=0.05, cache_max_age=60, cooldown=0)
    with pytest.raises(JwksUnavailable, match="too long"):
        asyncio.run(remote.reload())


def test_the_imported_key_cache_is_bounded(server: JwksServer) -> None:
    strategy = jwt_strategy(jwks_url=server.url)
    for index in range(65):
        strategy._imported[(index, "RS256")] = ({}, None)  # type: ignore[assignment]
    _verify(strategy, _rs({"sub": "u"}))
    assert len(strategy._imported) == 1
