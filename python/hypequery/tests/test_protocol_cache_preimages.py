"""RFC 0009 cache preimages against the shared `cache-preimages-v1` corpus."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.protocol import (
    ProtocolCachePreimageError,
    build_protocol_cache_preimage,
    derive_protocol_tenant_fingerprint,
)

FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "specs"
    / "security-protocol"
    / "fixtures"
    / "cache-preimages-v1"
)
SECRET = bytes([0x11]) * 32


def _fixtures(name: str) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], json.loads((FIXTURES / name).read_text()))


def _build(fixture: dict[str, object]) -> str:
    return build_protocol_cache_preimage(
        secret=bytes.fromhex(str(fixture["secretHex"])),
        definition_identity=cast(str, fixture["definitionIdentity"]),
        query=fixture["query"],
        tenant=cast(dict[str, object], fixture["tenant"]),
        row_limit=cast(int | None, fixture["rowLimit"]),
    )


@pytest.mark.parametrize("fixture", _fixtures("success.json"), ids=lambda item: str(item["id"]))
def test_shared_success_fixtures_build_exact_preimages(fixture: dict[str, object]) -> None:
    assert _build(fixture) == fixture["preimageUtf8"]


@pytest.mark.parametrize("fixture", _fixtures("rejections.json"), ids=lambda item: str(item["id"]))
def test_shared_rejection_fixtures_report_the_first_failure(fixture: dict[str, object]) -> None:
    with pytest.raises(ProtocolCachePreimageError) as caught:
        _build(fixture)
    assert caught.value.code == fixture["error"]
    assert str(caught.value) == fixture["error"]


def test_scoped_preimages_carry_the_public_fingerprint_function_output() -> None:
    preimage = json.loads(
        build_protocol_cache_preimage(
            secret=SECRET,
            definition_identity="a" * 64,
            query={"kind": "dataset", "dataset": "orders"},
            tenant={"mode": "scoped", "ids": ["acme"]},
            row_limit=None,
        )
    )
    assert preimage["tenant"]["fingerprints"] == [
        derive_protocol_tenant_fingerprint(SECRET, "acme")
    ]


def test_a_tuple_of_tenant_ids_is_accepted() -> None:
    def build(ids: object) -> str:
        return build_protocol_cache_preimage(
            secret=SECRET,
            definition_identity="a" * 64,
            query={"kind": "dataset", "dataset": "orders"},
            tenant={"mode": "scoped", "ids": ids},
            row_limit=None,
        )

    assert build(("b", "a")) == build(["a", "b"])
    with pytest.raises(ProtocolCachePreimageError):
        build("acme")


def test_a_fingerprint_needs_a_secret() -> None:
    with pytest.raises(ProtocolCachePreimageError) as caught:
        derive_protocol_tenant_fingerprint(b"", "acme")
    assert caught.value.code == "HQ_CACHE_PREIMAGE_SECRET_MISSING"
