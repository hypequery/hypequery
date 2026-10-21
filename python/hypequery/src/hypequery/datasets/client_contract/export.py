"""Canonical client artifacts from trusted logical endpoint definitions."""

from __future__ import annotations

from collections.abc import Sequence

from ...protocol import PreparedProtocolClientContract, prepare_protocol_client_contract
from ..constants import SUPPORTED_TIME_GRAINS
from ..registry import DatasetRegistry
from ..utils.derived_measures import base_measure_names
from .fields import public_fields
from .models import ClientEndpointDefinition


def endpoint_descriptor(
    definition: ClientEndpointDefinition, registry: DatasetRegistry | None, mount_path: str
) -> dict[str, object]:
    dataset = definition.dataset
    if not definition.path.startswith("/"):
        raise ValueError("client endpoint path must be absolute")
    if registry is not None:
        registered = registry.get(dataset.name)
        if registered is not None and registered != dataset:
            raise ValueError("client endpoint differs from its registered dataset definition")
    dimensions, measures, filters = public_fields(dataset, registry, definition.related)
    metric = definition.measure is not None
    if definition.name is not None:
        name = definition.name
    elif definition.measure is not None:
        name = definition.measure
    else:
        name = dataset.name
    if not metric and name != dataset.name:
        raise ValueError("dataset client export ID must equal the dataset name")
    if metric:
        if definition.measure not in dataset.measures:
            raise ValueError("client metric must reference a local dataset measure")
        # The public metric ID is its output alias, matching DatasetEndpoint/MetricAlias.
        measures = {name: {"wireType": "string", "nullable": True, "having": False}}
    node: dict[str, object] = {
        "id": name,
        "kind": "metric" if metric else "dataset",
        "dataset": dataset.name,
        "path": mount_path + definition.path,
        "dimensions": dimensions,
        "measures": measures,
        "filters": filters,
        "metadata": True,
        "limits": definition.profile.limits(dataset),
        "time": None
        if dataset.time_key is None
        else {
            "grains": sorted(dataset.time_grains or SUPPORTED_TIME_GRAINS),
            "defaultTimezone": definition.profile.default_timezone,
            "timezone": True,
            "periodFormat": "calendar-date-or-local-datetime-v1",
        },
    }
    if not metric:
        # An endpoint's default selection is the base measures it can serve.
        node["defaultMeasures"] = [
            name for name in base_measure_names(dataset.measures) if name in measures
        ]
    return node


def export_client_contract(
    endpoints: Sequence[ClientEndpointDefinition],
    *,
    registry: DatasetRegistry | None = None,
    mount_path: str = "",
) -> PreparedProtocolClientContract:
    """Export a deterministic build view without importing or connecting a backend.

    mount_path is trusted host configuration, not a proxy/request header. Supply
    final paths including router/inclusion prefixes; this pure function cannot
    infer how an application is mounted. Live authorized views belong to Serve.
    """
    return export_registered_client_contract(
        [(endpoint, registry) for endpoint in endpoints], mount_path=mount_path
    )


def export_registered_client_contract(
    endpoints: Sequence[tuple[ClientEndpointDefinition, DatasetRegistry | None]],
    *,
    mount_path: str = "",
) -> PreparedProtocolClientContract:
    """Export a build view where each endpoint resolves fields in its own registry.

    Separate clients may register different datasets under one name, so their
    registries are never merged into a shared namespace.
    """
    if mount_path and (not mount_path.startswith("/") or mount_path.endswith("/")):
        raise ValueError("mount_path must be empty or an absolute path without a trailing slash")
    return prepare_protocol_client_contract(
        {
            "kind": "hypequery-client-contract",
            "version": 1,
            "view": "build",
            "endpoints": [
                endpoint_descriptor(endpoint, registry, mount_path)
                for endpoint, registry in endpoints
            ],
        }
    )
