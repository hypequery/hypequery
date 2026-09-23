"""RFC 0005 closed query implementation union.

A named query has portable input and output schemas and exactly one
implementation: a validated semantic plan, one read-only compiled statement
with bound parameters, or an entrypoint in a hashed runtime artifact. The union
is closed so that "how is this answered" is always one of three inspectable
answers, never arbitrary text a caller could widen.

Python does not author named queries — its definition surface has no query
handles — but it reads them. A deployment built in TypeScript and consumed here
must be judged by the same rules, so this validates the artifact rather than
producing it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, TypeAlias

from .errors import ProtocolExpressionError, query_implementation_error
from .expression_models import ProtocolSemanticQuery, semantic_query_to_data
from .expressions import validate_protocol_semantic_query
from .identifiers import ProtocolIdentifier, ProtocolQualifiedIdentifier
from .query_implementation_primitives import (
    DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS,
    ProtocolQueryImplementationLimits,
    array,
    bounded_text,
    dialect,
    exact_fields,
    identifier,
    qualified_identifier,
    record,
)

_SHA256 = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
_RUNTIMES = ("node", "python")


@dataclass(frozen=True, slots=True)
class ProtocolSqlInputSource:
    """A parameter bound from a path in the named query's input object."""

    path: ProtocolQualifiedIdentifier
    kind: Literal["input"] = "input"


@dataclass(frozen=True, slots=True)
class ProtocolSqlTenantSource:
    """A parameter bound from trusted execution context, never from input."""

    kind: Literal["tenant"] = "tenant"


ProtocolSqlParameterSource: TypeAlias = ProtocolSqlInputSource | ProtocolSqlTenantSource


@dataclass(frozen=True, slots=True)
class ProtocolSqlParameter:
    """One named, typed parameter and where its value comes from."""

    name: ProtocolIdentifier
    source: ProtocolSqlParameterSource
    click_house_type: str


@dataclass(frozen=True, slots=True)
class ProtocolSqlRequiredTenant:
    """Names the one tenant-sourced parameter the statement must be given."""

    parameter: ProtocolIdentifier
    kind: Literal["required"] = "required"


@dataclass(frozen=True, slots=True)
class ProtocolSqlNotRequiredTenant:
    """An explicit assertion that this statement is safe without a tenant.

    Never inferred from the absence of a tenant parameter: a statement that
    forgot its tenant scoping and one that genuinely needs none are the same
    shape, and only the author can tell them apart.
    """

    kind: Literal["not-required"] = "not-required"


ProtocolSqlTenantPolicy: TypeAlias = ProtocolSqlRequiredTenant | ProtocolSqlNotRequiredTenant


@dataclass(frozen=True, slots=True)
class ProtocolSemanticPlanImplementation:
    """A fixed, already-validated semantic query."""

    query: ProtocolSemanticQuery
    kind: Literal["semantic-plan"] = "semantic-plan"


@dataclass(frozen=True, slots=True)
class ProtocolCompiledSqlImplementation:
    """One read-only statement, its bound parameters, and what it may read."""

    statement: str
    parameters: tuple[ProtocolSqlParameter, ...]
    read_sources: tuple[str, ...]
    tenant: ProtocolSqlTenantPolicy
    dialect: Literal["clickhouse"] = "clickhouse"
    operation: Literal["select"] = "select"
    kind: Literal["compiled-sql"] = "compiled-sql"


@dataclass(frozen=True, slots=True)
class ProtocolRuntimeReferenceImplementation:
    """An entrypoint in an artifact the containing bundle already hashes."""

    runtime: Literal["node", "python"]
    artifact_sha256: str
    entrypoint: ProtocolQualifiedIdentifier
    kind: Literal["runtime-reference"] = "runtime-reference"


ProtocolQueryImplementation: TypeAlias = (
    ProtocolSemanticPlanImplementation
    | ProtocolCompiledSqlImplementation
    | ProtocolRuntimeReferenceImplementation
)


def _parameter_source(value: object, path: str) -> ProtocolSqlParameterSource:
    source = record(value, path)
    kind = source.get("kind")
    if kind == "input":
        exact_fields(source, ("kind", "path"), path)
        return ProtocolSqlInputSource(path=qualified_identifier(source["path"], f"{path}.path"))
    if kind == "tenant":
        exact_fields(source, ("kind",), path)
        return ProtocolSqlTenantSource()
    if type(kind) is not str:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", f"{path}.kind")
    query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND", f"{path}.kind")


def _parameters(
    value: object, path: str, limits: ProtocolQueryImplementationLimits
) -> tuple[ProtocolSqlParameter, ...]:
    names: set[str] = set()
    parameters: list[ProtocolSqlParameter] = []
    for index, item in enumerate(array(value, path, limits.max_collection_items)):
        item_path = f"{path}[{index}]"
        parameter = record(item, item_path)
        exact_fields(parameter, ("name", "source", "clickHouseType"), item_path)
        name = identifier(parameter["name"], f"{item_path}.name")
        if name in names:
            query_implementation_error(
                "HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE", f"{item_path}.name"
            )
        names.add(name)
        parameters.append(
            ProtocolSqlParameter(
                name=name,
                source=_parameter_source(parameter["source"], f"{item_path}.source"),
                click_house_type=bounded_text(
                    parameter["clickHouseType"],
                    f"{item_path}.clickHouseType",
                    limits.max_type_bytes,
                ),
            )
        )
    return tuple(parameters)


def _tenant(
    value: object, path: str, parameters: tuple[ProtocolSqlParameter, ...]
) -> ProtocolSqlTenantPolicy:
    policy = record(value, path)
    kind = policy.get("kind")
    tenant_parameters = [parameter for parameter in parameters if parameter.source.kind == "tenant"]
    if kind == "not-required":
        exact_fields(policy, ("kind",), path)
        if tenant_parameters:
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE", path)
        return ProtocolSqlNotRequiredTenant()
    if kind == "required":
        exact_fields(policy, ("kind", "parameter"), path)
        parameter = identifier(policy["parameter"], f"{path}.parameter")
        if not any(candidate.name == parameter for candidate in tenant_parameters):
            query_implementation_error(
                "HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE", f"{path}.parameter"
            )
        # Exactly one: a second tenant parameter would be bound from trusted
        # context without the policy naming it, which is how a statement ends up
        # scoped by something nobody reviewed.
        if len(tenant_parameters) != 1:
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE", path)
        return ProtocolSqlRequiredTenant(parameter=parameter)
    if type(kind) is not str:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", f"{path}.kind")
    query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND", f"{path}.kind")


def _read_sources(
    value: object, path: str, limits: ProtocolQueryImplementationLimits
) -> tuple[str, ...]:
    sources = tuple(
        bounded_text(source, f"{path}[{index}]", limits.max_source_bytes)
        for index, source in enumerate(array(value, path, limits.max_collection_items))
    )
    if len(set(sources)) != len(sources):
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", path)
    return sources


def _semantic_plan(value: dict[str, object]) -> ProtocolSemanticPlanImplementation:
    exact_fields(value, ("kind", "query"), "$")
    try:
        query = validate_protocol_semantic_query(value["query"])
    except ProtocolExpressionError:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", "$.query")
    return ProtocolSemanticPlanImplementation(query=query)


def _compiled_sql(
    value: dict[str, object], limits: ProtocolQueryImplementationLimits
) -> ProtocolCompiledSqlImplementation:
    exact_fields(
        value,
        ("kind", "dialect", "operation", "statement", "parameters", "readSources", "tenant"),
        "$",
    )
    if value["operation"] != "select":
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", "$.operation")
    parameters = _parameters(value["parameters"], "$.parameters", limits)
    return ProtocolCompiledSqlImplementation(
        dialect=dialect(value["dialect"], "$.dialect"),
        statement=bounded_text(
            value["statement"], "$.statement", limits.max_statement_bytes, allow_sql_whitespace=True
        ),
        parameters=parameters,
        read_sources=_read_sources(value["readSources"], "$.readSources", limits),
        tenant=_tenant(value["tenant"], "$.tenant", parameters),
    )


def _runtime_reference(value: dict[str, object]) -> ProtocolRuntimeReferenceImplementation:
    exact_fields(value, ("kind", "runtime", "artifactSha256", "entrypoint"), "$")
    runtime = value["runtime"]
    if type(runtime) is not str or runtime not in _RUNTIMES:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", "$.runtime")
    digest = value["artifactSha256"]
    if type(digest) is not str or not _SHA256.match(digest):
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", "$.artifactSha256")
    return ProtocolRuntimeReferenceImplementation(
        runtime="node" if runtime == "node" else "python",
        artifact_sha256=digest,
        entrypoint=qualified_identifier(value["entrypoint"], "$.entrypoint"),
    )


def validate_protocol_query_implementation(
    value: object,
    *,
    limits: ProtocolQueryImplementationLimits = DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS,
) -> ProtocolQueryImplementation:
    """Validate plain data as one query implementation and detach it."""

    implementation = record(value, "$")
    kind = implementation.get("kind")
    if type(kind) is not str:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", "$.kind")
    if kind == "semantic-plan":
        return _semantic_plan(implementation)
    if kind == "compiled-sql":
        return _compiled_sql(implementation, limits)
    if kind == "runtime-reference":
        return _runtime_reference(implementation)
    query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND", "$.kind")


def _parameter_to_data(parameter: ProtocolSqlParameter) -> dict[str, object]:
    source: dict[str, object] = {"kind": parameter.source.kind}
    if isinstance(parameter.source, ProtocolSqlInputSource):
        source["path"] = parameter.source.path
    return {
        "name": parameter.name,
        "source": source,
        "clickHouseType": parameter.click_house_type,
    }


def query_implementation_to_data(
    implementation: ProtocolQueryImplementation,
) -> dict[str, object]:
    """Serialize a validated implementation back into detached protocol data."""

    if isinstance(implementation, ProtocolSemanticPlanImplementation):
        return {
            "kind": implementation.kind,
            "query": semantic_query_to_data(implementation.query),
        }
    if isinstance(implementation, ProtocolCompiledSqlImplementation):
        tenant: dict[str, object] = {"kind": implementation.tenant.kind}
        if isinstance(implementation.tenant, ProtocolSqlRequiredTenant):
            tenant["parameter"] = implementation.tenant.parameter
        return {
            "kind": implementation.kind,
            "dialect": implementation.dialect,
            "operation": implementation.operation,
            "statement": implementation.statement,
            "parameters": [
                _parameter_to_data(parameter) for parameter in implementation.parameters
            ],
            "readSources": list(implementation.read_sources),
            "tenant": tenant,
        }
    return {
        "kind": implementation.kind,
        "runtime": implementation.runtime,
        "artifactSha256": implementation.artifact_sha256,
        "entrypoint": implementation.entrypoint,
    }
