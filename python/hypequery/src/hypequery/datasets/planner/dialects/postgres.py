"""The Postgres dialect: ClickHouse semantics, spelled for Postgres.

Every spelling here returns what the ClickHouse dialect returns for the same
rows; where the engines differ, the difference is named next to the rule.
Parameters are positional (`$n`, in allocation order) and untyped, so the
server infers each from its context — the column it compares with — and an
index on that column stays usable.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from ...constants import SUPPORTED_TIME_GRAINS
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
    from .base import Aggregate

#: Parameter types, for diagnostics: placeholders carry no cast.
PARAMETER_TYPES: Final[Mapping[DimensionType, str]] = {
    "string": "text",
    "number": "double precision",
    "boolean": "boolean",
    "timestamp": "timestamptz",
}

_SCALAR_TYPES: Final[Mapping[str, str]] = {
    "String": "text",
    "Float64": "double precision",
    "Bool": "boolean",
    **dict.fromkeys(
        ("UInt8", "UInt16", "UInt32", "UInt64", "Int8", "Int16", "Int32", "Int64"), "bigint"
    ),
}

_SUB_DAY: Final = ("minute", "hour", "day")


@dataclass(frozen=True, slots=True)
class PostgresAggregate:
    """`function(argument)` with an optional `FILTER (WHERE …)` and empty-set value."""

    #: The call with `{}` where the input goes, e.g. `SUM({})`.
    template: str
    argument: str
    condition: str | None = None
    #: What ClickHouse's `-If` variant returns when no row matches (`sumIf` is 0).
    empty: str | None = None

    @property
    def sql(self) -> str:
        call = self.template.format(self.argument)
        if self.condition is None:
            return call
        filtered = f"{call} FILTER (WHERE {self.condition})"
        return filtered if self.empty is None else f"COALESCE({filtered}, {self.empty})"


def _arg_extreme(target: str, arg: str, direction: str) -> str:
    """ClickHouse `argMax`/`argMin`: *target* on the row with the extreme non-NULL arg."""

    return f"(ARRAY_AGG({target} ORDER BY {arg} {direction}) FILTER (WHERE {arg} IS NOT NULL))[1]"


class PostgresDialect:
    """Postgres SQL with positional `$n` server-side parameters."""

    __slots__ = ()

    @property
    def name(self) -> str:
        return "postgres"

    def quote(self, name: str) -> str:
        # Postgres folds unquoted names to lower case, so every name is quoted.
        return '"' + name.replace('"', '""') + '"'

    def placeholder(self, name: str, index: int, sql_type: str) -> str:
        return f"${index + 1}"

    def parameter_type(self, field_type: DimensionType) -> str:
        return PARAMETER_TYPES[field_type]

    def scalar_type(self, name: str) -> str:
        return _SCALAR_TYPES.get(name, name.lower())

    def array_type(self, element_type: str) -> str:
        return f"{element_type}[]"

    def membership(self, column: str, array_placeholder: str, *, negated: bool) -> str:
        member = f"{column} = ANY({array_placeholder})"
        # NULL stays NULL under NOT, as `NOT IN` does on ClickHouse.
        return f"NOT ({member})" if negated else member

    def time_comparison(
        self, column: str, zone_placeholder: str, probe: str
    ) -> tuple[str, Callable[[str], str] | None]:
        """Compare the bare column, so an index on it applies.

        Bound values are instants. A `date` column holds local dates, so it
        compares with the instant's wall clock in the query zone; a zone-less
        `timestamp` is read as UTC (the session zone), as on ClickHouse. The
        probe is an uncorrelated zero-row subquery: evaluated once, it leaves
        the right side constant.
        """

        def converted(placeholder: str) -> str:
            instant = f"CAST({placeholder} AS timestamptz)"
            return (
                f"(CASE WHEN pg_typeof({probe}) = 'date'::regtype "
                f"THEN {instant} AT TIME ZONE {zone_placeholder} ELSE {instant} END)"
            )

        return column, converted

    def aggregate(self, name: str, measure: Measure, target: str, arg: str | None) -> Aggregate:
        aggregation = measure.aggregation
        if aggregation in ("argMax", "argMin"):
            if arg is None:
                raise CompiledQueryError(
                    "internal", f'Measure "{name}" is {aggregation} without an arg field.'
                )
            direction = "DESC" if aggregation == "argMax" else "ASC"
            # The arg goes into the template, so a condition filters both.
            template = _arg_extreme("{}", arg.replace("{", "{{").replace("}", "}}"), direction)
            return PostgresAggregate(template, target)
        if aggregation == "percentile":
            if measure.level is None:
                raise CompiledQueryError(
                    "internal", f'Measure "{name}" is a percentile with no level.'
                )
            # A definition-time float in [0, 1], not caller input.
            return PostgresAggregate(
                f"percentile_cont({measure.level!r}) WITHIN GROUP (ORDER BY {{}})", target
            )
        templates = {
            "sum": ("SUM({})", "0"),
            "count": ("COUNT({})", None),
            "countDistinct": ("COUNT(DISTINCT {})", None),
            "avg": ("AVG({})", None),
            "min": ("MIN({})", None),
            "max": ("MAX({})", None),
            "stddev": ("stddev_samp({})", None),
            "variance": ("var_samp({})", None),
        }
        known = templates.get(aggregation)
        if known is None:
            raise CompiledQueryError("internal", f"Unknown aggregation {aggregation!r}.")
        return PostgresAggregate(known[0], target, empty=known[1])

    def conditional(self, aggregate: Aggregate, condition: str) -> Aggregate:
        if not isinstance(aggregate, PostgresAggregate):
            raise CompiledQueryError("internal", "not a Postgres aggregate")
        return PostgresAggregate(aggregate.template, aggregate.argument, condition, aggregate.empty)

    def divide(self, left: str, right: str) -> str:
        # ClickHouse `/` is floating point, and x/0 is inf, which results
        # report as null; Postgres truncates bigint / bigint and raises on /0.
        return f"(CAST({left} AS double precision) / NULLIF({right}, 0))"

    def round(self, expression: str, decimals_placeholder: str) -> str:
        """ClickHouse float `round`: scale, round half to even (`rint`), scale back."""

        operand = f"CAST({expression} AS double precision)"
        places = f"CAST({decimals_placeholder} AS integer)"
        scale = f"power(CAST(10 AS double precision), abs({places}))"
        return (
            f"(CASE WHEN {places} >= 0 THEN ROUND({operand} * {scale}) / {scale} "
            f"ELSE ROUND({operand} / {scale}) * {scale} END)"
        )

    def truncate_to_grain(self, grain: str, column: str, zone_placeholder: str) -> str:
        if grain not in SUPPORTED_TIME_GRAINS:
            supported = ", ".join(SUPPORTED_TIME_GRAINS)
            raise CompiledQueryError(
                "input-invalid", f'Unsupported time grain "{grain}". Supported: {supported}'
            )
        if grain == "week":
            # Sunday weeks, as ClickHouse `toStartOfWeek` (mode 0); Postgres weeks start Monday.
            wall = f"({column} AT TIME ZONE {zone_placeholder})"
            return (
                f"((date_trunc('week', {wall} + INTERVAL '1 day') - INTERVAL '1 day') "
                f"AT TIME ZONE {zone_placeholder})"
            )
        return f"date_trunc('{grain}', {column}, {zone_placeholder})"

    def period_text(self, bucket: str, grain: str, zone_placeholder: str) -> str:
        """RFC 0015 text: the bucket's wall clock in the query zone."""

        pattern = "YYYY-MM-DD HH24:MI:SS" if grain in _SUB_DAY else "YYYY-MM-DD"
        return f"to_char({bucket} AT TIME ZONE {zone_placeholder}, '{pattern}')"

    def in_time_zone(self, column: str, zone_placeholder: str) -> str:
        """An instant: a `date` is local midnight in the zone, a zone-less `timestamp` is UTC."""

        return (
            f"(CASE WHEN pg_typeof({column}) = 'date'::regtype "
            f"THEN ({column})::timestamp AT TIME ZONE {zone_placeholder} "
            f"ELSE ({column})::timestamptz END)"
        )

    def not_null(self, expression: str) -> str:
        return f"({expression} IS NOT NULL)"

    def match_marker(self, alias: str) -> str:
        # An unmatched LEFT JOIN row is all NULL on Postgres; any constant marks a match.
        return f"1 AS {alias}"

    def when(self, condition: str, expression: str) -> str:
        return f"CASE WHEN {condition} THEN {expression} ELSE NULL END"

    def group_key(self, expression: str, alias: str) -> str:
        # Postgres resolves a GROUP BY name to an input column before an output
        # alias, so a dimension aliased like a source column would group wrong.
        return expression

    def order_term(self, expression: str, descending: bool) -> str:
        # ClickHouse sorts NULLs last in both directions; Postgres puts them first under DESC.
        return f"{expression} DESC NULLS LAST" if descending else f"{expression} ASC"

    def row_count(self) -> str:
        return "COUNT(*)"

    def distinct_count(self, columns: list[str]) -> str:
        key = columns[0] if len(columns) == 1 else "ROW(" + ", ".join(columns) + ")"
        return f"COUNT(DISTINCT {key})"

    def render_select(self, node: DatasetSelectNode) -> str:
        from_clause = f" FROM {node.source}"
        if node.base_alias is not None:
            from_clause += f" AS {self.quote(node.base_alias.name)}"
        # ClickHouse LEFT ANY JOIN: at most one target row per base row, so a
        # duplicated to-one key cannot fan out the base aggregates. The lateral
        # subquery re-uses the alias, so the condition reads the inner row.
        joins = "".join(
            # Every part is a validated identifier or planner SQL; no value reaches it.
            f" LEFT JOIN LATERAL (SELECT * FROM {join.source} AS {self.quote(join.alias.name)}"  # noqa: S608
            f" WHERE {join.condition} LIMIT 1) AS {self.quote(join.alias.name)} ON TRUE"
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


POSTGRES: Final = PostgresDialect()
