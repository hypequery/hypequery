"""Golden projections: catalog, semantic contract, deployment and discovery.

The same definitions are projected four ways. Structural refactors of those
projections must leave this snapshot unchanged; an intentional change
regenerates it with ``HYPEQUERY_UPDATE_SNAPSHOTS=1`` in its own PR.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from golden_model import REGISTRY, Accounts, Customers, Events, Profiles, Regions
from hypequery.datasets import (
    build_protocol_dataset_contract,
    build_protocol_deployment_contract,
    create_dataset_registry,
    get_dataset_catalogs,
    serialize_semantic_contract,
)
from hypequery.serve.utils.discovery import public_discovery

SNAPSHOT = Path(__file__).parent / "snapshots" / "definition_projections.json"
UPDATE = os.environ.get("HYPEQUERY_UPDATE_SNAPSHOTS") == "1"

# Contract 2 refuses derived measures over derived measures, which the golden
# orders dataset has, so the full deployment covers every other dataset.
DEPLOYABLE = create_dataset_registry(Customers, Regions, Profiles, Accounts, Events)
ENDPOINTS: dict[str, dict[str, object]] = {
    "customers": {
        "access": {"kind": "authenticated", "roles": ["analyst"], "scopes": []},
        "tenant": {"kind": "required", "mode": "auto-inject", "column": "tenant_id"},
        "path": "/api/datasets/customers/query",
    }
}


def _current() -> dict[str, object]:
    return {
        "catalogs": get_dataset_catalogs(REGISTRY),
        "semanticContract": serialize_semantic_contract(REGISTRY),
        "publicSemanticContract": serialize_semantic_contract(REGISTRY, include_sql=False),
        "datasetContracts": {
            dataset.name: build_protocol_dataset_contract(dataset) for dataset in REGISTRY.get_all()
        },
        "deployment": build_protocol_deployment_contract(DEPLOYABLE, endpoints=ENDPOINTS),
        "discovery": public_discovery(REGISTRY),
    }


def test_golden_definition_projections() -> None:
    current = json.loads(json.dumps(_current(), sort_keys=True))
    if UPDATE:
        SNAPSHOT.parent.mkdir(exist_ok=True)
        SNAPSHOT.write_text(
            json.dumps(current, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    expected = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert sorted(current) == sorted(expected)
    for section, value in expected.items():
        assert current[section] == value, section
