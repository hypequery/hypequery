"""The semantic contract hashes text TypeScript can produce, surrogates included."""

from __future__ import annotations

import pytest

from hypequery.datasets import (
    create_dataset_registry,
    dataset,
    dimension,
    hash_contract,
    measure,
    serialize_semantic_contract,
)


def _contract(label: str) -> dict[str, object]:
    orders = dataset(
        "orders",
        source="orders",
        dimensions={"country": dimension.string(label=label)},
        measures={"n": measure.count("id")},
    )
    return serialize_semantic_contract(create_dataset_registry(orders))


@pytest.mark.parametrize(
    ("label", "typescript_hash"),
    [
        # Hashes from @hypequery/datasets serializeSemanticContract for the same model.
        ("plain", "65520d1ddf440d2ed1065daf4bc2db092fb627bd034dd6903d80ed24c65e5a6a"),
        ("Bad \ud800 lone", "e2d8874d603fa54364253f08039c034231ee254f61b3c825a9641fc9dafdd3e3"),
        (
            "Bad \ud800 lone, pair 😀, tab\t, nul\u0000,   end",
            "a8f2bc9c3f774b8a034b685bce73467cb5f428c2a8ad32807b58e71ce729e4e3",
        ),
    ],
)
def test_a_lone_surrogate_hashes_like_typescript(label: str, typescript_hash: str) -> None:
    contract = _contract(label)
    assert contract["contentHash"] == typescript_hash
    unhashed = {key: value for key, value in contract.items() if key != "contentHash"}
    assert hash_contract(unhashed) == typescript_hash
