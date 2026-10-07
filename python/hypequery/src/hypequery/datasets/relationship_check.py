"""Explicit sync/async verification of declared to-one relationships."""

from __future__ import annotations

from .client.results import AsyncQueryExecutor, QueryExecutor, ResultRows
from .dataset import Dataset
from .planner.context import ExecutionContext
from .registry import DatasetRegistry
from .relationship_check_plan import RelationshipKeyCheck, plan_relationship_checks
from .utils.relationship_key_check import (
    CheckRelationshipsResult,
    RelationshipKeyIssue,
    display_count,
    read_count,
)


class _CheckResults:
    def __init__(self, checks: tuple[RelationshipKeyCheck, ...]) -> None:
        self.checks = checks
        self.issues: list[RelationshipKeyIssue] = []

    def add(self, check: RelationshipKeyCheck, result: ResultRows) -> None:
        if (
            result.columns != ("__hq_rows", "__hq_keys")
            or len(result.rows) != 1
            or len(result.rows[0]) != 2
        ):
            raise ValueError("Invalid relationship key-count result")
        rows, keys = map(read_count, result.rows[0])
        if keys > rows:
            raise ValueError("Distinct keys cannot exceed checked rows")
        if rows > keys:
            column = check.columns[0]
            description = ", ".join(check.columns)
            message = (
                f'Relationship "{check.name}" is declared {check.kind}, but '
                f'"{check.target.source}.{description}" has {rows} rows for {keys} distinct keys. '
                "Joins pick an arbitrary matching row; make the key unique "
                "or declare the relationship as hasMany."
            )
            self.issues.append(
                RelationshipKeyIssue(
                    check.name,
                    check.kind,
                    check.target.name,
                    check.target.source,
                    column,
                    display_count(rows),
                    display_count(keys),
                    message,
                    check.columns,
                )
            )

    def result(self) -> CheckRelationshipsResult:
        return CheckRelationshipsResult(
            not self.issues, tuple(check.name for check in self.checks), tuple(self.issues)
        )


def check_relationships(
    dataset: Dataset,
    *,
    executor: QueryExecutor,
    registry: DatasetRegistry,
    context: ExecutionContext | None = None,
    relationships: tuple[str, ...] | None = None,
) -> CheckRelationshipsResult:
    """Check physical target keys within the trusted tenant scope; skip hasMany."""
    checks = plan_relationship_checks(
        dataset, registry, context or ExecutionContext(), relationships
    )
    results = _CheckResults(checks)
    for check in checks:
        results.add(check, executor.execute(check.compiled))
    return results.result()


async def check_relationships_async(
    dataset: Dataset,
    *,
    executor: AsyncQueryExecutor,
    registry: DatasetRegistry,
    context: ExecutionContext | None = None,
    relationships: tuple[str, ...] | None = None,
) -> CheckRelationshipsResult:
    """Async equivalent of check_relationships, preserving deadlines/cancellation."""
    checks = plan_relationship_checks(
        dataset, registry, context or ExecutionContext(), relationships
    )
    results = _CheckResults(checks)
    for check in checks:
        results.add(check, await executor.execute(check.compiled))
    return results.result()
