"""Business context authored in Python, and the v2 bundle that carries it."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from hypequery.datasets import (
    create_dataset_registry,
    define_business_context,
    prepare_dataset_bundle,
    write_dataset_bundle,
)
from hypequery.protocol import (
    ProtocolBusinessContextError,
    prepare_protocol_business_context,
    prepare_protocol_deployment_bundle_manifest,
)
from test_dataset_deployment import _endpoint, _model

#: The bundle identity of `_model()` with no business context; unchanged by this feature.
CONTRACT_ONLY_BUNDLE = "11134563ccaa1723e389d2b2072c4de2cb49f0ab89e565fa1923c6391955ecf2"


def _context() -> dict[str, object]:
    return dict(
        define_business_context(
            summary="Northwind sells analytics software to mid-market retailers.",
            business_model="Annual per-seat subscriptions.",
            kpis=[{"name": "Net revenue", "definition": "Paid order amount minus refunds, in €."}],
            glossary=[{"term": "Workspace", "meaning": "One paying customer account."}],
            conventions="EUR, UTC, weeks start on Monday.",
            caveats=["Orders before 2024-03 have no region."],
        )
    )


# Authoring ------------------------------------------------------------------


def test_keyword_arguments_become_the_wire_fields_in_canonical_order() -> None:
    context = define_business_context(
        caveats=("Test orders have negative ids.",),
        audience=" Finance ",
        business_model="Per seat.",
        goals=[],
        summary="Shop.",
    )
    assert context == {
        "kind": "hypequery-business-context",
        "version": 1,
        "summary": "Shop.",
        "businessModel": "Per seat.",
        "audience": "Finance",
        "caveats": ["Test orders have negative ids."],
    }
    assert list(context) == ["kind", "version", "summary", "businessModel", "audience", "caveats"]


def test_no_arguments_is_an_empty_document() -> None:
    assert define_business_context() == {"kind": "hypequery-business-context", "version": 1}


def test_an_invalid_document_raises_naming_the_field() -> None:
    with pytest.raises(ProtocolBusinessContextError, match=r"\$\.glossary\[1\]\.term") as raised:
        define_business_context(
            glossary=[{"term": "Seat", "meaning": "A user."}, {"term": "seat", "meaning": "Twice."}]
        )
    assert raised.value.code == "HQ_BUSINESS_CONTEXT_DUPLICATE"
    with pytest.raises(ProtocolBusinessContextError) as raised:
        define_business_context(business_model="  ")
    assert (raised.value.code, raised.value.path) == (
        "HQ_BUSINESS_CONTEXT_INVALID_VALUE",
        "$.businessModel",
    )


def test_only_keyword_arguments_are_accepted() -> None:
    with pytest.raises(TypeError):
        define_business_context("Shop.")  # type: ignore[call-arg]


# Bundles --------------------------------------------------------------------


def test_a_bundle_with_context_matches_the_typescript_cli() -> None:
    customers, orders = _model()
    registry = create_dataset_registry(customers, orders)
    bundle = prepare_dataset_bundle(
        registry, endpoints={"orders": _endpoint()}, business_context=_context()
    )
    prepared = prepare_protocol_business_context(_context())
    assert bundle.business_context_bytes == prepared.context_bytes + b"\n"
    assert bundle.business_context_identity == prepared.identity

    manifest = json.loads(bundle.manifest_bytes)
    assert manifest["version"] == 2
    assert manifest["businessContext"] == {
        "byteLength": len(bundle.business_context_bytes),
        "identity": prepared.identity,
        "path": "business-context.json",
        "sha256": hashlib.sha256(bundle.business_context_bytes).hexdigest(),
    }
    assert bundle.bundle_identity == prepare_protocol_deployment_bundle_manifest(manifest).identity
    # Produced by `@hypequery/cli`'s `writeDeploymentBundle` for the same
    # contract and business context.
    assert (
        bundle.deployment_identity
        == "8ab9ce91eee17f38072a733a68f28def960697cfa1ca97551253e0306d6904e0"
    )
    assert (
        bundle.business_context_identity
        == "b7e4818b5f1c2f9a35e06c1ff521dfbeec0b87e9f89b34c0f687688bffcbaa24"
    )
    assert (
        bundle.bundle_identity == "772e6e5176b10c86306ecacecda414319a7a93087dcd74f2009e60fb7de0b0a2"
    )


@pytest.mark.parametrize(
    "context",
    [None, {"kind": "hypequery-business-context", "version": 1}, {**define_business_context()}],
)
def test_no_or_empty_context_keeps_the_v1_bundle_identity(
    context: dict[str, object] | None,
) -> None:
    customers, orders = _model()
    bundle = prepare_dataset_bundle(
        create_dataset_registry(customers, orders),
        endpoints={"orders": _endpoint()},
        business_context=context,
    )
    assert json.loads(bundle.manifest_bytes)["version"] == 1
    assert bundle.business_context_bytes is None
    assert bundle.business_context_identity is None
    assert bundle.bundle_identity == CONTRACT_ONLY_BUNDLE


def test_a_glossary_change_is_a_new_bundle_identity() -> None:
    customers, orders = _model()
    registry = create_dataset_registry(customers, orders)
    first = prepare_dataset_bundle(registry, business_context=_context())
    changed = {**_context(), "glossary": [{"term": "Workspace", "meaning": "A tenant."}]}
    second = prepare_dataset_bundle(registry, business_context=changed)
    assert first.deployment_identity == second.deployment_identity
    assert first.bundle_identity != second.bundle_identity


def test_the_writer_adds_the_context_file(tmp_path: Path) -> None:
    customers, orders = _model()
    destination = tmp_path / "bundle"
    bundle = write_dataset_bundle(
        destination,
        create_dataset_registry(customers, orders),
        endpoints={"orders": _endpoint()},
        business_context=_context(),
    )
    assert {entry.name for entry in destination.iterdir()} == {
        "deployment.json",
        "business-context.json",
        "bundle.json",
    }
    assert (destination / "business-context.json").read_bytes() == bundle.business_context_bytes
    assert (destination / "bundle.json").read_bytes() == bundle.manifest_bytes


def test_an_invalid_context_writes_nothing(tmp_path: Path) -> None:
    customers, orders = _model()
    destination = tmp_path / "bundle"
    with pytest.raises(ProtocolBusinessContextError):
        write_dataset_bundle(
            destination,
            create_dataset_registry(customers, orders),
            business_context={"kind": "hypequery-business-context", "version": 1, "summary": ""},
        )
    assert not destination.exists()
    assert list(tmp_path.iterdir()) == []
