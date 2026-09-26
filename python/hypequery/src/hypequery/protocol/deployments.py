"""Strict RFC 0006 deployment contract validation.

A deployment contract is the validated, deterministic description of the
datasets managed execution can serve. Named queries, standalone metrics,
runtime artifacts, executable callbacks, credentials, and connection
configuration are outside it — `queries`, `artifacts`, and dataset `metrics`
are invalid even when empty.

Validation returns a detached snapshot built from fresh containers, so nothing
the caller still holds can change a contract after it has been validated or
hashed.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal, cast

from .deployment_nodes import (
    dataset_filter,
    dataset_limits,
    defaults,
    dimension,
    endpoint,
    expression_data,
    formula_grammar,
    formula_references,
    freshness,
    measure,
    relationship,
    tenant,
)
from .deployment_primitives import (
    APPROXIMATE_AGGREGATIONS,
    CUMULATIVE_AGGREGATIONS,
    DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS,
    GRAINS,
    SEMANTIC_METADATA_FIELDS,
    SUB_DAY_GRAINS,
    ProtocolDeploymentLimits,
    array,
    bounded_text,
    exact_fields,
    identifier,
    optional_text,
    record,
    semantic_metadata,
    unique_strings,
)
from .deployment_v3_nodes import segment, time_measure
from .errors import deployment_error

_ContractVersion = Literal[2, 3]

_METRIC_KINDS = frozenset(("metric", "derived-metric", "grained-metric"))
_DATASET_OPTIONAL = (
    "description",
    "freshness",
    "owner",
    "defaults",
    *SEMANTIC_METADATA_FIELDS,
    "timeField",
    "limits",
    "endpoint",
)


def _named_items(
    value: object,
    path: str,
    max_items: int,
    validate: Callable[[object, str, int], dict[str, object]],
) -> list[dict[str, object]]:
    """Validate a collection whose members are unique by name."""

    items = [
        validate(item, f"{path}[{index}]", index)
        for index, item in enumerate(array(value, path, max_items))
    ]
    if len({cast(str, item["name"]) for item in items}) != len(items):
        deployment_error("HQ_DEPLOYMENT_INVALID_REFERENCE", path)
    return items


def _substitute(expression: object, inputs: dict[str, object]) -> object:
    """Replace each aliased reference with the aggregate it stands for."""

    if type(expression) is list:
        return [_substitute(item, inputs) for item in cast(list[object], expression)]
    if type(expression) is not dict:
        return expression
    node = cast(dict[str, object], expression)
    name = node.get("name")
    if node.get("kind") == "reference" and type(name) is str and name in inputs:
        return inputs[name]
    return {key: _substitute(item, inputs) for key, item in node.items()}


def _derivation(
    value: object, path: str, limits: ProtocolDeploymentLimits, inlined: object
) -> dict[str, object]:
    """Validate a derived metric's formula in the shape it was authored in.

    Input order is significant and deliberately not sorted: each input becomes
    a column of the intermediate aggregate in this order, so two contracts
    differing only in input order are genuinely different contracts.
    """

    node = record(value, path)
    exact_fields(node, ("inputs", "expression"), (), path)
    items = array(node["inputs"], f"{path}.inputs", limits.max_dataset_items)
    if not items:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.inputs")

    seen: set[str] = set()
    inputs: list[dict[str, object]] = []
    for index, item in enumerate(items):
        item_path = f"{path}.inputs[{index}]"
        entry = record(item, item_path)
        exact_fields(entry, ("alias", "expression"), (), item_path)
        alias = identifier(entry["alias"], f"{item_path}.alias")
        if alias in seen:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{item_path}.alias")
        seen.add(alias)
        expression = expression_data(entry["expression"], f"{item_path}.expression")
        # Only an aggregate can become a column of the intermediate result.
        if expression.get("kind") != "aggregate":
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{item_path}.expression")
        inputs.append({"alias": alias, "expression": expression})

    expression = expression_data(node["expression"], f"{path}.expression")
    formula_grammar(expression, f"{path}.expression")
    # A bare reference names one input instead of combining them; nothing could
    # rebuild it, and the authoring API cannot produce it.
    if expression.get("kind") == "reference":
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.expression")
    # The authored and inlined forms must describe one formula, or the contract
    # advertises a meaning its aliases do not compute.
    substituted = _substitute(
        expression, {cast(str, entry["alias"]): entry["expression"] for entry in inputs}
    )
    if substituted != inlined:
        deployment_error("HQ_DEPLOYMENT_INVALID_REFERENCE", f"{path}.expression")
    return {"inputs": inputs, "expression": expression}


def _metric(value: object, path: str, limits: ProtocolDeploymentLimits) -> dict[str, object]:
    node = record(value, path)
    exact_fields(
        node,
        ("name", "kind", "expression", "dimensions", "filters", "grains", "endpoint"),
        ("grain", "derivation", "label", "description", *SEMANTIC_METADATA_FIELDS),
        path,
    )
    kind = node["kind"]
    if type(kind) is not str or kind not in _METRIC_KINDS:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.kind")

    def parse_grain(item: object, item_path: str) -> str:
        if type(item) is not str or item not in GRAINS:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", item_path)
        return item

    grains = unique_strings(node["grains"], f"{path}.grains", limits.max_dataset_items, parse_grain)
    if (kind == "grained-metric") != ("grain" in node):
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.grain")
    grain = parse_grain(node["grain"], f"{path}.grain") if "grain" in node else None
    if grain is not None and not grains:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.grains")
    if grain is not None and grain not in grains:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.grain")

    expression = expression_data(node["expression"], f"{path}.expression")
    result: dict[str, object] = {
        "name": identifier(node["name"], f"{path}.name"),
        "kind": kind,
        "expression": expression,
        "dimensions": unique_strings(
            node["dimensions"],
            f"{path}.dimensions",
            limits.max_dataset_items,
            lambda item, item_path: identifier(item, item_path, qualified=True),
        ),
        "filters": unique_strings(
            node["filters"],
            f"{path}.filters",
            limits.max_dataset_items,
            lambda item, item_path: identifier(item, item_path),
        ),
        "grains": grains,
        "endpoint": endpoint(node["endpoint"], f"{path}.endpoint", limits),
    }
    if grain is not None:
        result["grain"] = grain
    if "derivation" in node:
        # Eligibility follows the expression, not `kind`: a metric whose
        # expression is a bare aggregate has no formula, whatever its kind says.
        if expression.get("kind") == "aggregate":
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.derivation")
        result["derivation"] = _derivation(
            node["derivation"], f"{path}.derivation", limits, expression
        )
    optional_text(node, "label", result, path, limits)
    optional_text(node, "description", result, path, limits)
    semantic_metadata(node, result, path, limits)
    return result


def _derived_measure(
    value: object, path: str, limits: ProtocolDeploymentLimits, version: _ContractVersion = 2
) -> dict[str, object]:
    node = record(value, path)
    exact_fields(
        node,
        ("kind", "name", "uses", "expression"),
        (
            "label",
            "description",
            *SEMANTIC_METADATA_FIELDS,
            *(("approximate",) if version == 3 else ()),
        ),
        path,
    )
    if "approximate" in node and node["approximate"] is not True:
        deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.approximate")
    if node["kind"] != "derived":
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.kind")

    uses: list[dict[str, object]] = []
    for index, item in enumerate(array(node["uses"], f"{path}.uses", limits.max_dataset_items)):
        use_path = f"{path}.uses[{index}]"
        use = record(item, use_path)
        exact_fields(use, ("alias", "measure"), (), use_path)
        uses.append(
            {
                "alias": identifier(use["alias"], f"{use_path}.alias"),
                "measure": identifier(use["measure"], f"{use_path}.measure"),
            }
        )
    if not uses or len({cast(str, use["alias"]) for use in uses}) != len(uses):
        deployment_error("HQ_DEPLOYMENT_INVALID_REFERENCE", f"{path}.uses")

    expression = expression_data(node["expression"], f"{path}.expression")
    formula_grammar(expression, f"{path}.expression")
    if expression.get("kind") == "reference":
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.expression")
    references: set[str] = set()
    formula_references(expression, references)
    if len(references) != len(uses) or any(
        cast(str, use["alias"]) not in references for use in uses
    ):
        deployment_error("HQ_DEPLOYMENT_INVALID_REFERENCE", f"{path}.expression")

    result: dict[str, object] = {
        "kind": "derived",
        "name": identifier(node["name"], f"{path}.name"),
        "uses": uses,
        "expression": expression,
    }
    # Checked against the measures it uses by the dataset, once they are known.
    if node.get("approximate") is True:
        result["approximate"] = True
    optional_text(node, "label", result, path, limits)
    optional_text(node, "description", result, path, limits)
    semantic_metadata(node, result, path, limits)
    return result


def _dataset(
    value: object,
    path: str,
    limits: ProtocolDeploymentLimits,
    measure_indices: list[int] | None = None,
    version: _ContractVersion = 2,
) -> dict[str, object]:
    node = record(value, path)
    # Contract 3 renames the allow-list; the old name is then an unknown field.
    filters_key = "allowedFilters" if version == 3 else "filters"
    exact_fields(
        node,
        (
            "name",
            "source",
            "tenant",
            "dimensions",
            "measures",
            filters_key,
            "metrics",
            "relationships",
        ),
        (*_DATASET_OPTIONAL, *(("segments",) if version == 3 else ())),
        path,
    )
    result: dict[str, object] = {
        "name": identifier(node["name"], f"{path}.name"),
        "source": bounded_text(node["source"], f"{path}.source", limits.max_source_bytes),
        "tenant": tenant(node["tenant"], f"{path}.tenant", limits),
        "dimensions": _named_items(
            node["dimensions"],
            f"{path}.dimensions",
            limits.max_dataset_items,
            lambda item, item_path, _index: dimension(item, item_path, limits),
        ),
        "measures": _named_items(
            node["measures"],
            f"{path}.measures",
            limits.max_dataset_items,
            # Base measures are validated apart from derived ones, so the
            # reported path has to point back at the authored position.
            lambda item, item_path, index: measure(
                item,
                item_path
                if measure_indices is None
                else f"{path}.measures[{measure_indices[index]}]",
                limits,
                version,
            ),
        ),
        filters_key: _named_items(
            node[filters_key],
            f"{path}.{filters_key}",
            limits.max_dataset_items,
            lambda item, item_path, _index: dataset_filter(item, item_path, limits),
        ),
        "metrics": _named_items(
            node["metrics"],
            f"{path}.metrics",
            limits.max_dataset_items,
            lambda item, item_path, _index: _metric(item, item_path, limits),
        ),
        "relationships": _named_items(
            node["relationships"],
            f"{path}.relationships",
            limits.max_dataset_items,
            lambda item, item_path, _index: relationship(item, item_path),
        ),
    }
    if version == 3 and "segments" in node:
        result["segments"] = _named_items(
            node["segments"],
            f"{path}.segments",
            limits.max_dataset_items,
            lambda item, item_path, _index: segment(
                item,
                item_path,
                limits,
                cast(list[dict[str, object]], result["dimensions"]),
                cast(dict[str, object], result["tenant"]),
            ),
        )
    if "timeField" in node:
        result["timeField"] = identifier(node["timeField"], f"{path}.timeField", qualified=True)
    optional_text(node, "description", result, path, limits)
    optional_text(node, "owner", result, path, limits)
    semantic_metadata(node, result, path, limits)
    if "freshness" in node:
        result["freshness"] = freshness(node["freshness"], f"{path}.freshness")
    if "defaults" in node:
        result["defaults"] = defaults(node["defaults"], f"{path}.defaults", limits, version)
    if "limits" in node:
        result["limits"] = dataset_limits(node["limits"], f"{path}.limits")
    if "endpoint" in node:
        result["endpoint"] = endpoint(node["endpoint"], f"{path}.endpoint", limits)
    return result


def validate_protocol_dataset_contract(
    value: object,
    *,
    limits: ProtocolDeploymentLimits = DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS,
) -> dict[str, object]:
    """Validate one dataset contract and return it as detached protocol data."""

    return _dataset(value, "$", limits)


def _deployment_dataset(
    value: object, path: str, limits: ProtocolDeploymentLimits, version: _ContractVersion = 2
) -> dict[str, object]:
    """Validate a dataset whose measures fold base and composite kinds into one array."""

    node = record(value, path)
    exact_fields(
        node,
        (
            "name",
            "source",
            "tenant",
            "dimensions",
            "measures",
            "allowedFilters" if version == 3 else "filters",
            "relationships",
        ),
        (*_DATASET_OPTIONAL, *(("segments",) if version == 3 else ())),
        path,
    )
    measures = [
        record(item, f"{path}.measures[{index}]")
        for index, item in enumerate(
            array(node["measures"], f"{path}.measures", limits.max_dataset_items)
        )
    ]

    # Base measures are validated by the dataset; composite ones (derived, and
    # in contract 3 window and shift) reference them and are validated here.
    def composite_kind(item: dict[str, object]) -> bool:
        kind = item.get("kind")
        return kind == "derived" or (version == 3 and kind in ("window", "shift"))

    base = [(index, item) for index, item in enumerate(measures) if not composite_kind(item)]
    validated = _dataset(
        {**node, "measures": [item for _index, item in base], "metrics": []},
        path,
        limits,
        [index for index, _item in base],
        version,
    )
    composite: list[dict[str, object] | None] = []
    for index, item in enumerate(measures):
        measure_path = f"{path}.measures[{index}]"
        if item.get("kind") == "derived":
            composite.append(_derived_measure(item, measure_path, limits, version))
        elif composite_kind(item):
            composite.append(time_measure(item, measure_path, limits))
        else:
            composite.append(None)

    validated_base = cast(list[dict[str, object]], validated["measures"])
    base_by_name = {cast(str, item["name"]): item for item in validated_base}
    ordered: list[dict[str, object]] = []
    base_index = 0
    for entry in composite:
        if entry is not None:
            ordered.append(entry)
        else:
            ordered.append(validated_base[base_index])
            base_index += 1
    if len({cast(str, item["name"]) for item in ordered}) != len(measures):
        deployment_error("HQ_DEPLOYMENT_INVALID_REFERENCE", f"{path}.measures")

    def approximate(item: dict[str, object] | None) -> bool:
        return item is not None and item.get("approximate") is True

    # A time measure wraps exactly one base measure and needs the time axis.
    time_by_name: dict[str, dict[str, object]] = {}
    for index, entry in enumerate(composite):
        if entry is None or entry["kind"] == "derived":
            continue
        measure_path = f"{path}.measures[{index}]"
        wrapped = base_by_name.get(cast(str, entry["measure"]))
        if wrapped is None:
            deployment_error("HQ_DEPLOYMENT_INVALID_REFERENCE", f"{measure_path}.measure")
        if "timeField" not in validated:
            deployment_error("HQ_DEPLOYMENT_INVALID_REFERENCE", f"{measure_path}.kind")
        if (
            entry.get("cumulative") is True
            and wrapped["aggregation"] not in CUMULATIVE_AGGREGATIONS
        ):
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{measure_path}.cumulative")
        if approximate(wrapped) != approximate(entry):
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{measure_path}.approximate")
        time_by_name[cast(str, entry["name"])] = entry

    for index, entry in enumerate(composite):
        if entry is None or entry["kind"] != "derived":
            continue
        uses = cast(list[dict[str, object]], entry["uses"])
        for use_index, use in enumerate(uses):
            name = cast(str, use["measure"])
            if name not in base_by_name and name not in time_by_name:
                deployment_error(
                    "HQ_DEPLOYMENT_INVALID_REFERENCE",
                    f"{path}.measures[{index}].uses[{use_index}].measure",
                )
        uses_approximate = any(
            approximate(
                base_by_name.get(cast(str, use["measure"]))
                or time_by_name.get(cast(str, use["measure"]))
            )
            for use in uses
        )
        if uses_approximate != approximate(entry):
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.measures[{index}].approximate")

    return {**{k: v for k, v in validated.items() if k != "metrics"}, "measures": ordered}


def _dataset_references(datasets: list[dict[str, object]]) -> None:
    """Check the rules that only hold across a whole contract."""

    names = {cast(str, dataset["name"]) for dataset in datasets}
    for index, dataset in enumerate(datasets):
        declared = cast(dict[str, object], dataset.get("defaults") or {})
        dimensions = cast(list[dict[str, object]], dataset["dimensions"])
        default_dimensions = cast(list[str], declared.get("dimensions") or [])
        groupable = {cast(str, item["name"]) for item in dimensions if item["groupable"] is True}
        if any(name not in groupable for name in default_dimensions):
            deployment_error(
                "HQ_DEPLOYMENT_INVALID_REFERENCE", f"$.datasets[{index}].defaults.dimensions"
            )
        if "timeGrain" in declared and "timeField" not in dataset:
            deployment_error(
                "HQ_DEPLOYMENT_INVALID_REFERENCE", f"$.datasets[{index}].defaults.timeGrain"
            )
        for relationship_index, item in enumerate(
            cast(list[dict[str, object]], dataset["relationships"])
        ):
            if cast(str, item["target"]) not in names:
                deployment_error(
                    "HQ_DEPLOYMENT_INVALID_REFERENCE",
                    f"$.datasets[{index}].relationships[{relationship_index}].target",
                )
        declared_endpoint = dataset.get("endpoint")
        if declared_endpoint is not None:
            dataset_tenant = cast(dict[str, object], dataset["tenant"])
            endpoint_tenant = cast(
                dict[str, object], cast(dict[str, object], declared_endpoint)["tenant"]
            )
            if (dataset_tenant["kind"] == "required") != (endpoint_tenant["kind"] == "required"):
                deployment_error(
                    "HQ_DEPLOYMENT_INVALID_REFERENCE", f"$.datasets[{index}].endpoint.tenant"
                )


def validate_protocol_deployment_contract(
    value: object,
    *,
    limits: ProtocolDeploymentLimits = DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS,
) -> dict[str, object]:
    """Validate a deployment contract and return it as detached protocol data.

    Unsupported fields are forbidden, even when empty.
    """

    node = record(value, "$")
    exact_fields(node, ("kind", "version", "datasets"), (), "$")
    if node["kind"] != "hypequery-deployment":
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", "$.kind")
    version = node["version"]
    if type(version) is bool or version != 2:
        deployment_error("HQ_DEPLOYMENT_INVALID_VERSION", "$.version")
    datasets = _named_items(
        node["datasets"],
        "$.datasets",
        limits.max_datasets,
        lambda item, path, _index: _deployment_dataset(item, path, limits),
    )
    _dataset_references(datasets)
    return {"kind": "hypequery-deployment", "version": 2, "datasets": datasets}


def _uses_contract_3_feature(dataset: dict[str, object]) -> bool:
    measures = cast(list[dict[str, object]], dataset["measures"])
    grain = cast(dict[str, object], dataset.get("defaults") or {}).get("timeGrain")
    return (
        bool(dataset.get("segments"))
        or any(
            item.get("aggregation") in APPROXIMATE_AGGREGATIONS
            or item.get("kind") in ("window", "shift")
            for item in measures
        )
        or grain in SUB_DAY_GRAINS
    )


def validate_protocol_deployment_contract_v3(
    value: object,
    *,
    limits: ProtocolDeploymentLimits = DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS,
) -> dict[str, object]:
    """Validate a deployment contract 3 (RFC 0015) and return detached data.

    Contract 3 renames the filter allow-list to ``allowedFilters`` and adds
    segments, ``approxCountDistinct``, window and shift measures, and sub-day
    default grains. Under the lowest-version rule, an envelope that uses none of
    those must be published as contract 2 and is rejected here.
    """

    node = record(value, "$")
    exact_fields(node, ("kind", "version", "datasets"), (), "$")
    if node["kind"] != "hypequery-deployment":
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", "$.kind")
    version = node["version"]
    if type(version) is bool or version != 3:
        deployment_error("HQ_DEPLOYMENT_INVALID_VERSION", "$.version")
    datasets = _named_items(
        node["datasets"],
        "$.datasets",
        limits.max_datasets,
        lambda item, path, _index: _deployment_dataset(item, path, limits, 3),
    )
    _dataset_references(datasets)
    if not any(_uses_contract_3_feature(dataset) for dataset in datasets):
        deployment_error("HQ_DEPLOYMENT_INVALID_VERSION", "$.version")
    return {"kind": "hypequery-deployment", "version": 3, "datasets": datasets}
