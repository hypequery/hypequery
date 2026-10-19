"""Stateful dataset SQL compilation, independent of clients and execution.

One compiler instance owns one query's state: the statement node its features
fill, the parameter binder, and the aliases selected so far. Features (see
`features/`) each own one concern and reach the others through the compiler,
mirroring `@hypequery/clickhouse`'s query builder. The planner wraps the
resulting SQL in the execution contract.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from ..dataset import Dataset
from ..registry import DatasetRegistry
from ..utils.query_timezone import validate_timezone
from .aliases import BASE_ALIAS
from .context import ExecutionContext
from .dialects import CLICKHOUSE, SqlDialect
from .errors import CompiledQueryError
from .features.dimensions import DimensionFeature
from .features.fields import FieldFeature
from .features.filtering import FilterFeature
from .features.having import HavingFeature
from .features.joins import JoinFeature
from .features.measures import MeasureFeature
from .features.ordering import OrderingFeature
from .identifiers import SafeIdentifier, safe_qualified_identifier
from .parameters import ParameterBinder, TypedParameter
from .query import DatasetQuery
from .query_node import DatasetSelectNode
from .query_validation import resolve_tenant_scope
from .resolution import references_a_relationship, selected_measure_names


@dataclass(frozen=True, slots=True)
class DatasetSql:
    """SQL and typed parameters before execution metadata is attached."""

    sql: str
    parameters: Mapping[str, TypedParameter]


class DatasetQueryCompiler:
    """Compile one query, collecting its selections, joins and parameters."""

    def __init__(
        self,
        dataset: Dataset,
        query: DatasetQuery,
        registry: DatasetRegistry,
        context: ExecutionContext,
        *,
        overfetch: bool = False,
        dialect: SqlDialect = CLICKHOUSE,
    ) -> None:
        self.dialect = dialect
        self.dataset = dataset
        self.query = query
        self.registry = registry
        self.context = context
        self.overfetch = overfetch
        self.selected_measures = selected_measure_names(dataset, query)
        self.timezone = validate_timezone(query.timezone or "UTC")
        # Qualify base columns only when a relationship could make them ambiguous.
        self.joins_active = references_a_relationship(dataset, query)
        self.binder = ParameterBinder()
        self.node = DatasetSelectNode()
        #: Output name to alias for everything selected so far; ordering reads it.
        self.orderable: dict[str, SafeIdentifier] = {}

        self.fields = FieldFeature(self)
        self.joins = JoinFeature(self)
        self.dimensions = DimensionFeature(self)
        self.measures = MeasureFeature(self)
        self.filtering = FilterFeature(self)
        self.having = HavingFeature(self)
        self.ordering = OrderingFeature(self)

    def compile(self) -> DatasetSql:
        scope = resolve_tenant_scope(self.dataset, self.context)
        for name in self.query.dimensions:
            if name in self.selected_measures:
                raise CompiledQueryError(
                    "input-invalid",
                    f'Output "{name}" cannot be selected as both a dimension and a measure. '
                    "Select one or give the definitions distinct names.",
                )
        # Order matters twice over. Dimensions and measures register the joins and
        # aliases that filters and ordering resolve against, and the call order is
        # the parameter allocation order.
        self.dimensions.add()
        self.measures.add()
        if not self.node.selections:
            raise CompiledQueryError(
                "input-invalid",
                f'Dataset "{self.dataset.name}" query must select '
                "at least one dimension or measure.",
            )
        self.filtering.add(scope)
        self.having.add()
        self.ordering.add()
        self.ordering.paginate()

        self.node.source = safe_qualified_identifier(self.dataset.source, what="dataset source").sql
        self.node.base_alias = BASE_ALIAS if self.joins_active else None
        return DatasetSql(self.dialect.render_select(self.node), self.binder.parameters)
