"""Read-only uniqueness plans over physical target keys."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .dataset import Dataset
from .planner.admission import check_execution_admission
from .planner.compiled_query import CompiledQuery, validate_correlation_id
from .planner.context import ExecutionContext, effective_deadline
from .planner.identifiers import safe_identifier, safe_qualified_identifier
from .planner.parameters import ParameterBinder
from .planner.query_validation import resolve_tenant_scope
from .planner.settings import DEFAULT_QUERY_SETTINGS, tighten_query_settings
from .registry import DatasetRegistry


@dataclass(frozen=True, slots=True)
class RelationshipKeyCheck:
    name: str
    kind: Literal["belongsTo", "hasOne"]
    target: Dataset
    columns: tuple[str, ...]
    compiled: CompiledQuery


def plan_relationship_checks(
    dataset: Dataset,
    registry: DatasetRegistry,
    context: ExecutionContext,
    relationships: tuple[str, ...] | None,
) -> tuple[RelationshipKeyCheck, ...]:
    check_execution_admission(context)
    resolve_tenant_scope(dataset, context)
    if relationships is not None:
        if len(set(relationships)) != len(relationships):
            raise ValueError("Relationship names must be distinct")
        for name in relationships:
            relation = dataset.relationships.get(name)
            if relation is None or relation.kind == "hasMany":
                raise ValueError("Relationship checks require declared to-one relationships")
    checks: list[RelationshipKeyCheck] = []
    settings = tighten_query_settings(DEFAULT_QUERY_SETTINGS, context.settings)
    for name, relation in dataset.relationships.items():
        if relation.kind == "hasMany" or (relationships is not None and name not in relationships):
            continue
        target = registry.require(relation.target)
        scope = resolve_tenant_scope(target, context)
        columns = tuple(key.to_field for key in relation.key_pairs)
        quoted = [safe_identifier(column, what="relationship target key").sql for column in columns]
        predicates = [f"isNotNull({column})" for column in quoted]
        binder = ParameterBinder()
        if target.tenant_key is not None and scope is not None:
            tenant_column = safe_identifier(target.tenant_key, what="tenant key").sql
            if len(scope.ids) == 1:
                placeholder = binder.bind(scope.ids[0], "String")
                predicates.append(f"{tenant_column} = {placeholder}")
            else:
                placeholder = binder.bind_array(scope.ids, "String")
                predicates.append(f"{tenant_column} IN {placeholder}")
        key_sql = quoted[0] if len(quoted) == 1 else "tuple(" + ", ".join(quoted) + ")"
        source = safe_qualified_identifier(target.source, what="dataset source").sql
        sql = (
            f"SELECT count() AS `__hq_rows`, uniqExact({key_sql}) AS `__hq_keys` "  # noqa: S608
            f"FROM {source} WHERE " + " AND ".join(predicates)
        )
        compiled = CompiledQuery(
            sql=sql,
            parameters=binder.parameters,
            settings=settings,
            deadline=effective_deadline(context.deadline, settings.max_execution_time),
            cancellation=context.cancellation,
            correlation_id=validate_correlation_id(context.correlation_id),
        )
        checks.append(RelationshipKeyCheck(name, relation.kind, target, columns, compiled))
    return tuple(checks)
