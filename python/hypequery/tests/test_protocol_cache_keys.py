"""RFC 0013 cache key derivation against the shared `cache-keys-v1` corpus.

The conformance runner proves the same fixtures over NDJSON; these cases pin
the Python-only surface around them: input types, the TextEncoder-compatible
encoding of unpaired surrogates, and errors that carry nothing but a code.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.protocol import (
    ProtocolCacheKeyError,
    derive_protocol_cache_key,
    derive_protocol_cache_namespace_token,
)

FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "specs"
    / "security-protocol"
    / "fixtures"
    / "cache-keys-v1"
)
SECRET = bytes.fromhex("11" * 32)
PREIMAGE = '{"kind":"dataset","target":"orders","v":1}'


def _fixtures(name: str) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], json.loads((FIXTURES / name).read_text()))


def _preimage(fixture: dict[str, object]) -> str:
    generator = fixture.get("generator")
    if isinstance(generator, dict):
        return str(generator["utf8"]) * int(generator["count"])
    return str(fixture["preimageUtf8"])


def _derive(fixture: dict[str, object]) -> str:
    namespace = cast(dict[str, str], fixture["namespace"])
    return derive_protocol_cache_key(
        secret=bytes.fromhex(str(fixture["secretHex"])),
        project=namespace["project"],
        environment=namespace["environment"],
        key_version=cast(int, fixture["keyVersion"]),
        preimage=_preimage(fixture),
    )


@pytest.mark.parametrize("fixture", _fixtures("success.json"), ids=lambda item: str(item["id"]))
def test_shared_success_fixtures_derive_exact_keys(fixture: dict[str, object]) -> None:
    namespace = cast(dict[str, str], fixture["namespace"])
    secret = bytes.fromhex(str(fixture["secretHex"]))

    assert _derive(fixture) == fixture["key"]
    token = derive_protocol_cache_namespace_token(
        secret, namespace["project"], namespace["environment"]
    )
    assert token == fixture["namespaceToken"]


@pytest.mark.parametrize("fixture", _fixtures("rejections.json"), ids=lambda item: str(item["id"]))
def test_shared_rejection_fixtures_report_the_first_failure(fixture: dict[str, object]) -> None:
    with pytest.raises(ProtocolCacheKeyError) as caught:
        _derive(fixture)
    assert caught.value.code == fixture["error"]
    assert str(caught.value) == fixture["error"]


def test_a_sensitive_preimage_leaves_no_trace_in_the_key_or_error() -> None:
    preimage = '{"tenant":{"value":"acme_corp"},"email":"ana@example.com"}'
    key = derive_protocol_cache_key(
        secret=SECRET, project="acme", environment="production", key_version=1, preimage=preimage
    )
    assert "acme_corp" not in key
    assert "ana" not in key

    with pytest.raises(ProtocolCacheKeyError) as caught:
        derive_protocol_cache_key(
            secret=SECRET,
            project="acme",
            environment="production",
            key_version=1,
            preimage=preimage * 20_000,
        )
    assert "acme_corp" not in repr(caught.value)
    assert SECRET.hex() not in repr(caught.value)


def test_bytes_and_text_preimages_derive_the_same_key() -> None:
    def derive(preimage: bytes | str) -> str:
        return derive_protocol_cache_key(
            secret=SECRET,
            project="acme",
            environment="production",
            key_version=1,
            preimage=preimage,
        )

    assert derive(PREIMAGE) == derive(PREIMAGE.encode())
    assert derive("café \U0001f600") == derive("café \U0001f600".encode())


def test_unpaired_surrogates_encode_as_textencoder_does() -> None:
    def derive(preimage: bytes | str) -> str:
        return derive_protocol_cache_key(
            secret=SECRET,
            project="acme",
            environment="production",
            key_version=1,
            preimage=preimage,
        )

    # TextEncoder replaces a lone surrogate with U+FFFD and joins a split pair.
    assert derive("a\ud800b") == derive("a�b".encode())
    assert derive("😀") == derive("\U0001f600".encode())


@pytest.mark.parametrize("key_version", [True, 1.0, "1", None])
def test_a_key_version_must_be_a_plain_integer(key_version: object) -> None:
    with pytest.raises(ProtocolCacheKeyError) as caught:
        derive_protocol_cache_key(
            secret=SECRET,
            project="acme",
            environment="production",
            key_version=key_version,  # type: ignore[arg-type]
            preimage=PREIMAGE,
        )
    assert caught.value.code == "HQ_CACHE_KEY_INVALID_VERSION"


def test_a_missing_secret_fails_closed() -> None:
    for secret in (None, b""):
        with pytest.raises(ProtocolCacheKeyError) as caught:
            derive_protocol_cache_namespace_token(secret, "acme", "production")
        assert caught.value.code == "HQ_CACHE_KEY_SECRET_MISSING"


def test_a_secret_must_be_bytes() -> None:
    with pytest.raises(TypeError):
        derive_protocol_cache_namespace_token(
            "1" * 64,  # type: ignore[arg-type]
            "acme",
            "production",
        )


def test_a_non_text_preimage_is_a_type_error() -> None:
    with pytest.raises(TypeError):
        derive_protocol_cache_key(
            secret=SECRET,
            project="acme",
            environment="production",
            key_version=1,
            preimage=bytearray(b"x"),  # type: ignore[arg-type]
        )
