"""Dataset planning orchestration and the compiled-query execution contract.

Admission and contract checks run before SQL compilation. A per-query compiler
owns SQL state; this entry point attaches settings, deadlines and correlation
metadata. Metrics and named queries are absent from Python's definition surface.
"""

from __future__ import annotations

from ..dataset import Dataset
from ..registry import DatasetRegistry, create_dataset_registry
from .admission import check_execution_admission
from .aliases import BASE_ALIAS as BASE_ALIAS
from .aliases import PERIOD_ALIAS as PERIOD_ALIAS
from .compiled_query import CompiledQuery, validate_correlation_id
from .compiler import DatasetQueryCompiler
from .context import ExecutionContext, effective_deadline
from .query import DatasetQuery
from .query_validation import check_query_limits, check_reserved_alias
from .settings import DEFAULT_QUERY_SETTINGS, QuerySettings, tighten_query_settings


def plan_dataset_query(
    dataset: Dataset,
    query: DatasetQuery | None = None,
    *,
    registry: DatasetRegistry | None = None,
    context: ExecutionContext | None = None,
    settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
    overfetch: bool = False,
) -> CompiledQuery:
    """Compile a semantic query over *dataset* into an executable statement.

    *registry* is only needed when the query traverses a relationship: a Python
    relationship stores its target's name, and the registry is what turns that
    name back into a dataset.
    """

    query = query or DatasetQuery()
    context = context or ExecutionContext()
    check_execution_admission(context)
    check_query_limits(dataset, query)
    check_reserved_alias(dataset)
    compiler = DatasetQueryCompiler(
        dataset,
        query,
        registry or create_dataset_registry(dataset),
        context,
        overfetch=overfetch,
    )
    settings = tighten_query_settings(settings, context.settings)
    compiled = compiler.compile()
    return CompiledQuery(
        sql=compiled.sql,
        parameters=compiled.parameters,
        operation="query",
        settings=settings,
        deadline=effective_deadline(context.deadline, settings.max_execution_time),
        cancellation=context.cancellation,
        correlation_id=validate_correlation_id(context.correlation_id),
    )
