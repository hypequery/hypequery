"""Build a validated RFC 0006 deployment from Python dataset definitions.

The contract version follows RFC 0015's lowest-version rule: a deployment is
contract 3 only when a dataset uses segments, window or shift measures, or
``approxCountDistinct``. Every other deployment keeps the contract 2 bytes and
identity it had before contract 3. TypeScript's
``buildProtocolDeploymentContract`` emits the same contract for the same
definition; ``specs/datasets/contract-3-authoring-v1.json`` pins both.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from hypequery.protocol import (
    validate_protocol_dataset_contract,
    validate_protocol_deployment_contract,
    validate_protocol_deployment_contract_v3,
)

from .dataset import Dataset
from .deployment_values import filter_expression
from .derived_measures import DerivedMeasure
from .dimensions import DimensionType
from .measures import Measure
from .registry import DatasetRegistry
from .relationships import Relationship
from .time_measures import ShiftMeasure, WindowMeasure
from .utils.approximate_measures import is_approximate_base_measure, is_approximate_measure
from .utils.definition_projection import (
    filter_operators,
    is_queryable,
    limits_node,
    metadata,
    relationship_node,
)
from .utils.deployable_formulas import deployable_measure_issues
from .utils.derived_measures import derived_measure_node
from .utils.portable_grains import assert_publishable_time_grains
from .utils.portable_order import portable_name_key


def _field_schema(field_type: DimensionType | None) -> dict[str, str]:
    if field_type in ("string", "timestamp"):
        return {"kind": "string"}
    if field_type == "number":
        return {"kind": "number"}
    if field_type == "boolean":
        return {"kind": "boolean"}
    return {"kind": "any"}


def _relationship_node(name: str, relation: Relationship) -> dict[str, object]:
    return {"name": name, **relationship_node(relation), "queryable": is_queryable(relation)}


def _sql_expression(
    sql: str, dependencies: tuple[str, ...] | None, output: dict[str, str], name: str
) -> dict[str, object]:
    if dependencies is None:
        raise ValueError(f'SQL-backed field "{name}" must declare dependencies.')
    return {
        "kind": "sql-expression",
        "dialect": "clickhouse",
        "sql": sql,
        "output": output,
        "dependencies": sorted(dependencies),
    }


def _dataset_record(
    dataset: Dataset, endpoint: Mapping[str, object] | None, contract_version: int
) -> dict[str, object]:
    """The unvalidated dataset body both contract versions share.

    Dimensions, base measures, the filter allow-list (as ``filters``),
    relationships and limits. At contract 3 a base measure may be
    ``approxCountDistinct`` and carries ``approximate`` when it estimates.
    Window, shift and derived measures and segments are added by the
    deployment builder, which also renames ``filters`` for contract 3.
    Mirrors TypeScript's ``protocolDatasetRecord``.
    """

    # No contract carries an allowed-grain policy. Refuse a restriction rather
    # than turn it into an unrestricted deployed dataset.
    assert_publishable_time_grains(dataset.name, dataset.time_grains)
    dimensions: list[dict[str, object]] = []
    for name, dimension in sorted(
        dataset.dimensions.items(), key=lambda item: portable_name_key(item[0])
    ):
        source = (
            _sql_expression(
                dimension.sql, dimension.dependencies, _field_schema(dimension.field_type), name
            )
            if dimension.sql is not None
            else {"kind": "column", "column": dimension.column or name}
        )
        entry: dict[str, object] = {
            "name": name,
            "type": dimension.field_type,
            "source": source,
            "filterable": dimension.filterable is not False,
            "groupable": dimension.groupable is not False,
            **metadata(dimension.label, dimension.description),
        }
        dimensions.append(entry)

    measures: list[dict[str, object]] = []
    for name, measure in sorted(
        dataset.measures.items(), key=lambda item: portable_name_key(item[0])
    ):
        if not isinstance(measure, Measure):
            continue
        entry = {
            "name": name,
            "aggregation": measure.aggregation,
            "field": measure.field,
            "filters": [filter_expression(item) for item in measure.filters or ()],
        }
        if measure.arg_field is not None:
            entry["argField"] = measure.arg_field
        if measure.level is not None:
            entry["level"] = measure.level
        if measure.state_function is not None:
            entry["stateFunction"] = measure.state_function
        if measure.sql is not None:
            field_type = dataset.dimensions.get(measure.field)
            entry["sql"] = _sql_expression(
                measure.sql,
                measure.dependencies,
                _field_schema(field_type.field_type if field_type is not None else None),
                name,
            )
        if contract_version == 3 and is_approximate_base_measure(measure):
            entry["approximate"] = True
        entry.update(metadata(measure.label, measure.description))
        measures.append(entry)

    filters: list[dict[str, object]] = []
    for name, definition in sorted(
        dataset.filters.items(), key=lambda item: portable_name_key(item[0])
    ):
        filters.append(
            {
                "name": name,
                "field": definition.field,
                "operators": filter_operators(definition),
                **metadata(definition.label, definition.description),
            }
        )

    relationships = [
        _relationship_node(name, relation)
        for name, relation in sorted(
            dataset.relationships.items(), key=lambda item: portable_name_key(item[0])
        )
    ]
    result: dict[str, object] = {"name": dataset.name}
    # Contract datasets carry a description but no label, as in TypeScript.
    if dataset.description is not None:
        result["description"] = dataset.description
    result["source"] = dataset.source
    if dataset.row_resolution is not None:
        result["rowResolution"] = dataset.row_resolution.to_protocol()
    result |= {
        "tenant": (
            {"kind": "required", "field": dataset.tenant_key}
            if dataset.tenant_key is not None
            else {"kind": "not-required"}
        ),
        "dimensions": dimensions,
        "measures": measures,
        "filters": filters,
        "metrics": [],
        "relationships": relationships,
    }
    if dataset.time_key is not None:
        result["timeField"] = dataset.time_key
    if dataset.limits is not None:
        result["limits"] = limits_node(dataset.limits)
    if endpoint is not None:
        result["endpoint"] = dict(endpoint)
    return result


def build_protocol_dataset_contract(
    dataset: Dataset, *, endpoint: Mapping[str, object] | None = None
) -> dict[str, object]:
    """Convert one definition to a validated local dataset snapshot.

    The snapshot is contract 2 shaped, so it refuses every contract 3 feature
    by name; ``build_protocol_deployment_contract`` emits those as contract 3.
    Mirrors TypeScript's ``buildProtocolDatasetContract``.
    """

    shifts = [name for name, item in dataset.measures.items() if isinstance(item, ShiftMeasure)]
    if shifts:
        raise ValueError(
            f'Dataset "{dataset.name}" shift measures ({", ".join(shifts)}) need deployment '
            "contract 3 (RFC 0015)."
        )
    windows = [name for name, item in dataset.measures.items() if isinstance(item, WindowMeasure)]
    if windows:
        raise ValueError(
            f'Dataset "{dataset.name}" window measures ({", ".join(windows)}) need deployment '
            "contract 3 (RFC 0015)."
        )
    if dataset.segments:
        raise ValueError(
            f'Dataset "{dataset.name}" declares segments ({", ".join(dataset.segments)}), which '
            "cannot be published here: segments need deployment contract 3 (RFC 0015). "
            "Publish them in a deployment contract."
        )
    for name, item in dataset.measures.items():
        if isinstance(item, Measure) and item.aggregation == "approxCountDistinct":
            raise ValueError(
                f'Measure "{dataset.name}.{name}" uses approxCountDistinct, which cannot be '
                "published here: approximate aggregations need deployment contract 3 "
                "(RFC 0015). Publish it as a dataset measure, or use countDistinct here."
            )
    # Reuse the protocol validator for strict identifiers, expression limits,
    # and a detached return value. Cross-dataset references are checked by the
    # containing deployment validator.
    return validate_protocol_dataset_contract(_dataset_record(dataset, endpoint, 2))


def validate_deployable(dataset: Dataset) -> None:
    """Refuse a dataset the deployment contract cannot carry.

    Local queries accept every formula the ``formula`` helpers build. A
    deployment contract accepts a narrower subset: derived measures may not
    reference other derived measures, and a literal may appear only as
    ``round`` decimals or as a ``coalesce`` fallback.
    ``build_protocol_deployment_contract`` and ``write_dataset_bundle`` run this
    check first, so the error names the dataset and measure
    (``orders.doubled: ...``) instead of a contract path.
    """

    if dataset.limits is not None and dataset.limits.max_stream_rows is not None:
        # Mirrors TypeScript: the contract's limits cannot carry it, and a
        # deployment must not quietly fall back to `max_result_size`.
        raise ValueError(
            f'Dataset "{dataset.name}" sets limits.max_stream_rows, which is not part of '
            "deployment contracts yet; publish the dataset without it."
        )
    for name, issue in deployable_measure_issues(dataset.measures):
        raise ValueError(f"{dataset.name}.{name}: {issue}")


def uses_contract_3_features(dataset: Dataset) -> bool:
    """True when the deployment holding *dataset* must be contract 3 (RFC 0015).

    Mirrors TypeScript's ``usesContract3Features``. Python datasets have no
    default grain, so a sub-day default cannot raise the version here.
    """

    return bool(dataset.segments) or any(
        isinstance(item, WindowMeasure | ShiftMeasure)
        or (isinstance(item, Measure) and item.aggregation == "approxCountDistinct")
        for item in dataset.measures.values()
    )


def _derived_measures(dataset: Dataset, contract_version: int) -> list[dict[str, object]]:
    """Derived measures in declaration order.

    At contract 3 a derived measure carries ``approximate`` when any input,
    through windows and shifts too, estimates.
    """

    nodes: list[dict[str, object]] = []
    for name, item in dataset.measures.items():
        if not isinstance(item, DerivedMeasure):
            continue
        node = derived_measure_node(name, item)
        if contract_version == 3 and is_approximate_measure(dataset.measures, name):
            node["approximate"] = True
        nodes.append(node)
    return nodes


def _time_measure_node(
    dataset: Dataset, name: str, definition: WindowMeasure | ShiftMeasure
) -> dict[str, object]:
    wrapped = dataset.measures.get(definition.measure)
    node: dict[str, object] = {
        "kind": "shift" if isinstance(definition, ShiftMeasure) else "window",
        "name": name,
        "measure": definition.measure,
        "requiresTimeRange": True,
    }
    if isinstance(wrapped, Measure) and is_approximate_base_measure(wrapped):
        node["approximate"] = True
    node.update(metadata(definition.label, definition.description))
    if isinstance(definition, ShiftMeasure):
        node["interval"] = {
            "amount": definition.interval.amount,
            "unit": definition.interval.unit,
        }
        return node
    if definition.trailing is not None:
        node["trailing"] = {
            "amount": definition.trailing.amount,
            "unit": definition.trailing.unit,
        }
    if definition.to_date is not None:
        node["toDate"] = definition.to_date
    if definition.cumulative is True:
        node["cumulative"] = True
    return node


def _segment_nodes(dataset: Dataset) -> list[dict[str, object]]:
    """Segments sorted by name; several filters are the ``and`` of their comparisons."""

    nodes: list[dict[str, object]] = []
    for name, definition in sorted(
        dataset.segments.items(), key=lambda item: portable_name_key(item[0])
    ):
        conditions = [filter_expression(item) for item in definition.filters]
        predicate = (
            conditions[0]
            if len(conditions) == 1
            else {"kind": "logical", "operator": "and", "operands": conditions}
        )
        nodes.append(
            {
                "name": name,
                "predicate": predicate,
                **metadata(definition.label, definition.description),
            }
        )
    return nodes


def _contract_2_dataset(
    dataset: Dataset, endpoint: Mapping[str, object] | None
) -> dict[str, object]:
    snapshot = build_protocol_dataset_contract(dataset, endpoint=endpoint)
    entry = {key: value for key, value in snapshot.items() if key != "metrics"}
    entry["measures"] = [
        *cast(list[dict[str, object]], snapshot["measures"]),
        *_derived_measures(dataset, 2),
    ]
    return entry


def _contract_3_dataset(
    dataset: Dataset, endpoint: Mapping[str, object] | None
) -> dict[str, object]:
    """Base measures sorted by name, then window and shift, then derived measures.

    Window, shift and derived measures keep declaration order. The filter
    allow-list is ``allowedFilters``, and ``segments`` is present only when
    declared.
    """

    record = _dataset_record(dataset, endpoint, 3)
    entry = {key: value for key, value in record.items() if key not in ("metrics", "filters")}
    entry["measures"] = [
        *cast(list[dict[str, object]], record["measures"]),
        *(
            _time_measure_node(dataset, name, item)
            for name, item in dataset.measures.items()
            if isinstance(item, WindowMeasure | ShiftMeasure)
        ),
        *_derived_measures(dataset, 3),
    ]
    entry["allowedFilters"] = record["filters"]
    segments = _segment_nodes(dataset)
    if segments:
        entry["segments"] = segments
    return entry


def build_protocol_deployment_contract(
    registry: DatasetRegistry,
    *,
    endpoints: Mapping[str, Mapping[str, object]] | None = None,
) -> dict[str, object]:
    """Build and validate a dataset-only deployment contract, version 2 or 3.

    The version follows RFC 0015's lowest-version rule (see the module
    docstring). Every registered relationship target is included. Only datasets named in
    ``endpoints`` become directly queryable Cloud endpoints.
    """

    datasets = sorted(registry.get_all(), key=lambda item: portable_name_key(item.name))
    if endpoints is not None:
        unknown = set(endpoints) - {dataset.name for dataset in datasets}
        if unknown:
            raise ValueError(f"Endpoint names an unregistered dataset: {min(unknown)}")
    for dataset in datasets:
        validate_deployable(dataset)
    if not any(uses_contract_3_features(dataset) for dataset in datasets):
        return validate_protocol_deployment_contract(
            {
                "kind": "hypequery-deployment",
                "version": 2,
                "datasets": [
                    _contract_2_dataset(dataset, (endpoints or {}).get(dataset.name))
                    for dataset in datasets
                ],
            }
        )
    return validate_protocol_deployment_contract_v3(
        {
            "kind": "hypequery-deployment",
            "version": 3,
            "datasets": [
                _contract_3_dataset(dataset, (endpoints or {}).get(dataset.name))
                for dataset in datasets
            ],
        }
    )
