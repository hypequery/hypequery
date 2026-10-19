"""The ClickHouse dialect: every ClickHouse-specific spelling the planner emits."""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Final

from ...constants import GRAIN_FUNCTIONS
from ..aggregates import AggregateCall
from ..errors import CompiledQueryError
from ..sql_fragments import (
    group_by_clause,
    having_clause,
    order_by_clause,
    pagination_clause,
    select_clause,
    where_clause,
)

if TYPE_CHECKING:
    from ...dimensions import DimensionType
    from ...measures import Measure
    from ..query_node import DatasetSelectNode

#: The ClickHouse type each declared dimension type binds as. These are the
#: widest safe reading of a logical type; the executor narrows them against the
#: real column type, which is the only place the physical schema is known.
PARAMETER_TYPES: Final[Mapping[DimensionType, str]] = {
    "string": "String",
    "number": "Float64",
    "boolean": "Bool",
    "timestamp": "DateTime64(3)",
}

#: Plain aggregations; argMax/argMin and percentile take extra operands.
_AGGREGATE_FUNCTIONS: Final = {
    "sum": "sum",
    "count": "count",
    "countDistinct": "uniqExact",
    "avg": "avg",
    "min": "min",
    "max": "max",
    "stddev": "stddevSamp",
    "variance": "varSamp",
}


class ClickHouseDialect:
    """ClickHouse SQL with `{name:Type}` server parameters."""

    __slots__ = ()

    @property
    def name(self) -> str:
        return "clickhouse"

    def parameter_type(self, field_type: DimensionType) -> str:
        return PARAMETER_TYPES[field_type]

    def aggregate(self, name: str, measure: Measure, target: str, arg: str | None) -> AggregateCall:
        aggregation = measure.aggregation
        if aggregation in ("argMax", "argMin"):
            if arg is None:
                raise CompiledQueryError(
                    "internal", f'Measure "{name}" is {aggregation} without an arg field.'
                )
            return AggregateCall(aggregation, (target, arg))
        if aggregation == "percentile":
            if measure.level is None:
                raise CompiledQueryError(
                    "internal", f'Measure "{name}" is a percentile with no level.'
                )
            # The level is a definition-time float the measure model already bounded
            # to [0, 1], not caller input, and ClickHouse takes it as a function
            # parameter rather than a bindable value.
            return AggregateCall("quantile", (target,), (repr(measure.level),))
        function = _AGGREGATE_FUNCTIONS.get(aggregation)
        if function is None:
            raise CompiledQueryError("internal", f"Unknown aggregation {aggregation!r}.")
        return AggregateCall(function, (target,))

    def conditional(self, aggregate: AggregateCall, condition: str) -> AggregateCall:
        # The -If combinator: `sumIf(x, cond)`, `quantileIf(l)(x, cond)`.
        return aggregate.with_condition(condition)

    def truncate_to_grain(self, grain: str, column: str) -> str:
        function = GRAIN_FUNCTIONS.get(grain)
        if function is None:
            supported = ", ".join(GRAIN_FUNCTIONS)
            raise CompiledQueryError(
                "input-invalid", f'Unsupported time grain "{grain}". Supported: {supported}'
            )
        return f"{function}({column})"

    def period_text(self, bucket: str) -> str:
        """Render a grain bucket as RFC 0015's result form.

        Sub-day and day buckets are ClickHouse ``DateTime`` values, which ClickHouse's
        JSON output (and so TypeScript) renders as wall-clock ``YYYY-MM-DD HH:MM:SS``
        in the bucket's zone. The Python driver would instead return an instant that
        the result codec writes in UTC. Formatting in ClickHouse yields the same text
        in both languages. Week-and-longer buckets are ``Date`` values, rendered as
        ``YYYY-MM-DD`` either way. Both forms sort chronologically as text.
        """

        return f"toString({bucket})"

    def in_time_zone(self, column: str, zone_placeholder: str) -> str:
        return f"toDateTime64({column}, 9, {zone_placeholder})"

    def not_null(self, expression: str) -> str:
        return f"isNotNull({expression})"

    def match_marker(self, alias: str) -> str:
        # Without join_use_nulls an unmatched LEFT JOIN row carries column
        # defaults; a Nullable constant is the one value that tells them apart.
        return f"toNullable(1) AS {alias}"

    def when(self, condition: str, expression: str) -> str:
        return f"if({condition}, {expression}, NULL)"

    def row_count(self) -> str:
        return "count()"

    def distinct_count(self, columns: list[str]) -> str:
        key = columns[0] if len(columns) == 1 else "tuple(" + ", ".join(columns) + ")"
        return f"uniqExact({key})"

    def render_select(self, node: DatasetSelectNode) -> str:
        from_clause = f" FROM {node.source}"
        if node.base_alias is not None:
            from_clause += f" AS {node.base_alias.sql}"
        # ANY: each base row meets at most one target row, so a duplicated
        # to-one key cannot fan out the base aggregates.
        joins = "".join(
            f" LEFT ANY JOIN {join.source} AS {join.alias.sql} ON {join.condition}"
            for join in node.joins
        )
        return (
            select_clause(node.selections)
            + from_clause
            + joins
            + where_clause(node.where)
            + group_by_clause(node.group_by)
            + having_clause(node.having)
            + order_by_clause(node.order_by)
            + pagination_clause(node.limit, node.offset)
        )


#: The dialect every compilation uses today.
CLICKHOUSE: Final = ClickHouseDialect()
