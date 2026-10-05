"""Stateful dataset SQL compilation, independent of clients and execution.

One compiler instance owns one query's joins, selections and parameter binder.
The planner wraps the resulting SQL in the execution contract.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from ..dataset import Dataset
from ..dimensions import Dimension
from ..measures import Measure
from ..query_helpers import Filter
from ..registry import DatasetRegistry
from ..relationships import Relationship
from ..utils.relationship_measures import measure_filter_field
from .aliases import BASE_ALIAS, PERIOD_ALIAS
from .context import ExecutionContext, TenantScope
from .errors import CompiledQueryError
from .filter_validation import validate_filter_value
from .identifiers import SafeIdentifier, safe_identifier, safe_qualified_identifier
from .parameters import (
    ParameterBinder,
    TypedParameter,
    clickhouse_type_for,
    require_scalar,
    require_sequence,
)
from .query import DatasetQuery
from .query_validation import resolve_tenant_scope
from .resolution import (
    is_qualified,
    references_a_relationship,
    require_dimension,
    resolve_filter_field,
    resolve_qualified_field,
    resolve_relationship_measure,
)
from .sql_fragments import (
    aliased,
    grain_expression,
    group_by_clause,
    order_by_clause,
    pagination_clause,
    select_clause,
    trusted_expression,
    where_clause,
)

_ARRAY_OPERATORS = frozenset(("in", "notIn"))
_MATCH_MARKER = "_hq_match"


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
    ) -> None:
        self.dataset = dataset
        self.query = query
        self.registry = registry
        self.context = context
        self.overfetch = overfetch
        self.binder = ParameterBinder()
        self.selections: list[str] = []
        self.group_by: list[str] = []
        self.predicates: list[str] = []
        self.joins: list[str] = []
        self.joined: set[str] = set()
        # A relationship whose target measures are selected joins through a
        # projection carrying a match marker; see `_measure_join_source`.
        self.measure_relationships = {
            name.partition(".")[0] for name in query.measures or () if is_qualified(name)
        }
        self.match_markers: dict[str, SafeIdentifier] = {}
        # Qualify base columns only when a relationship could make them ambiguous.
        self.joins_active = references_a_relationship(dataset, query)
        self.orderable: dict[str, SafeIdentifier] = {}

    def compile(self) -> DatasetSql:
        query = self.query
        scope = resolve_tenant_scope(self.dataset, self.context)

        for name in query.dimensions:
            if name in (query.measures or ()):
                raise CompiledQueryError(
                    "input-invalid",
                    f'Output "{name}" cannot be selected as both a dimension and a measure. '
                    "Select one or give the definitions distinct names.",
                )
        # Order matters: dimensions and measures register the joins and aliases that
        # filters and ordering resolve against.
        self._add_dimensions(query)
        self._add_measures(query)
        if not self.selections:
            raise CompiledQueryError(
                "input-invalid",
                f'Dataset "{self.dataset.name}" query must select '
                "at least one dimension or measure.",
            )
        self._add_filters(query, scope)
        order_by = self._add_order_by(query)

        source = safe_qualified_identifier(self.dataset.source, what="dataset source")
        from_clause = f" FROM {source.sql}"
        if self.joins_active:
            from_clause += f" AS {BASE_ALIAS.sql}"
        result_limit = query.limit
        if result_limit is None and self.dataset.limits is not None:
            result_limit = self.dataset.limits.max_result_size
        sql = (
            select_clause(self.selections)
            + from_clause
            + "".join(self.joins)
            + where_clause(self.predicates)
            + group_by_clause(self.group_by)
            + order_by_clause(order_by)
            + pagination_clause(
                result_limit + 1 if self.overfetch and result_limit is not None else result_limit,
                query.offset,
            )
        )
        return DatasetSql(sql, self.binder.parameters)

    def _tenant_predicate(self, column_sql: str, scope: TenantScope) -> str:
        """Bind the proven tenant identifiers as a parameter, never as text."""

        if len(scope.ids) == 1:
            placeholder = self.binder.bind(scope.ids[0], "String")
            return f"{column_sql} = {placeholder}"
        placeholder = self.binder.bind_array(scope.ids, "String")
        return f"{column_sql} IN {placeholder}"

    def _base_column(self, dimension: Dimension | None, name: str) -> str:
        """The SQL for a base-dataset field: its trusted expression or its column."""

        if dimension is not None and dimension.sql is not None:
            if self.joins_active:
                # A raw expression is written unqualified, so a bare `price` in it
                # could bind to a joined table's column instead of this one's.
                raise CompiledQueryError(
                    "input-invalid",
                    f'SQL-backed field "{name}" cannot be combined with relationship joins.',
                )
            return trusted_expression(dimension.sql)
        column = dimension.column if dimension is not None and dimension.column else name
        column_sql = safe_identifier(column, what="column").sql
        return f"{BASE_ALIAS.sql}.{column_sql}" if self.joins_active else column_sql

    def _measure_join_source(self, relationship_name: str, target: Dataset) -> str:
        """The target as a projection whose marker is non-null only on a match.

        Without `join_use_nulls`, an unmatched LEFT JOIN row carries column
        defaults such as `0` and `''`, which `min` or `countDistinct` would
        count. The marker is the one value that tells a match from a default,
        and an explicit projection keeps it from colliding with a target column.
        """

        relationship = self.dataset.relationships[relationship_name]
        columns = [relationship.to_field]
        if target.tenant_key is not None:
            columns.append(target.tenant_key)
        for name, dimension in target.dimensions.items():
            if dimension.sql is None:
                columns.append(dimension.column or name)
        for name in self.query.measures or ():
            owner, _, measure_name = name.partition(".")
            if owner != relationship_name or measure_name not in target.measures:
                continue
            measure = target.measures[measure_name]
            for field in (measure.field, measure.arg_field):
                if field is not None:
                    declared = target.dimensions.get(field)
                    columns.append(declared.column or field if declared else field)
        unique = list(dict.fromkeys(columns))
        marker = _MATCH_MARKER
        while marker in unique:
            marker += "_"
        self.match_markers[relationship_name] = safe_identifier(marker, what="match marker")
        projection = [safe_identifier(column, what="column").sql for column in unique]
        projection.append(f"toNullable(1) AS {self.match_markers[relationship_name].sql}")
        source = safe_qualified_identifier(target.source, what="dataset source")
        # Every part is a validated identifier or a constant; no value reaches it.
        return f"(SELECT {', '.join(projection)} FROM {source.sql})"  # noqa: S608

    def _ensure_relationship_join(
        self, relationship_name: str, relationship: Relationship, target: Dataset
    ) -> SafeIdentifier:
        """Add the single-match LEFT ANY JOIN a relationship needs, once."""

        alias = safe_identifier(relationship_name, what="relationship name")
        if relationship_name not in self.joined:
            self.joined.add(relationship_name)
            if relationship_name in self.measure_relationships:
                target_source = self._measure_join_source(relationship_name, target)
            else:
                target_source = safe_qualified_identifier(target.source, what="dataset source").sql
            left = safe_identifier(relationship.from_field, what="relationship from field")
            right = safe_identifier(relationship.to_field, what="relationship to field")
            condition = f"{BASE_ALIAS.sql}.{left.sql} = {alias.sql}.{right.sql}"
            # The joined dataset carries its own tenancy, so the predicate goes into
            # the join condition rather than WHERE: in a LEFT ANY JOIN a WHERE predicate
            # on the right side would silently turn it into an inner join.
            target_scope = resolve_tenant_scope(target, self.context)
            if target_scope is not None and target.tenant_key is not None:
                tenant_column = safe_identifier(target.tenant_key, what="tenant key")
                condition += " AND " + self._tenant_predicate(
                    f"{alias.sql}.{tenant_column.sql}", target_scope
                )
            self.joins.append(f" LEFT ANY JOIN {target_source} AS {alias.sql} ON {condition}")
        return alias

    def _ensure_join(self, name: str) -> tuple[str, SafeIdentifier]:
        """The joined column a qualified field selects, adding its join once."""

        resolved = resolve_qualified_field(self.dataset, name, registry=self.registry)
        alias = self._ensure_relationship_join(
            resolved.relationship_name, resolved.relationship, resolved.target
        )
        column = resolved.dimension.column or resolved.dimension_name
        return f"{alias.sql}.{safe_identifier(column, what='column').sql}", alias

    def _field_sql(self, name: str) -> str:
        """The SQL for any queryable field, base or relationship-qualified."""

        if is_qualified(name):
            expression, _ = self._ensure_join(name)
            return expression
        return self._base_column(self.dataset.dimensions.get(name), name)

    def _add_dimensions(self, query: DatasetQuery) -> None:
        if query.by is not None:
            if self.dataset.time_key is None:
                raise CompiledQueryError(
                    "input-invalid",
                    f'Cannot group by time — dataset "{self.dataset.name}" has no time key.',
                )
            time_column = self._base_column(None, self.dataset.time_key)
            self.selections.append(aliased(grain_expression(query.by, time_column), PERIOD_ALIAS))
            self.group_by.append(PERIOD_ALIAS.sql)
            self.orderable[PERIOD_ALIAS.name] = PERIOD_ALIAS

        for name in query.dimensions:
            if is_qualified(name):
                dimension = resolve_qualified_field(
                    self.dataset, name, registry=self.registry
                ).dimension
                expression = self._field_sql(name)
            else:
                dimension = require_dimension(self.dataset, name)
                expression = self._field_sql(name)
            if dimension.groupable is False:
                raise CompiledQueryError("input-invalid", f'Dimension "{name}" is not groupable.')
            # Every selection is aliased to the name the caller used, so grouping
            # and ordering reference one stable label whatever the expression is.
            alias = SafeIdentifier(name)
            self.selections.append(aliased(expression, alias))
            self.group_by.append(alias.sql)
            self.orderable[name] = alias

    def _aggregation_sql(self, name: str, measure: Measure) -> str:
        """The aggregate call for one measure, over its field or its trusted SQL."""

        if measure.sql is not None:
            if self.joins_active:
                raise CompiledQueryError(
                    "input-invalid",
                    f'SQL-backed measure "{name}" cannot be combined with relationship joins.',
                )
            target = trusted_expression(measure.sql)
        else:
            target = self._base_column(self.dataset.dimensions.get(measure.field), measure.field)
        arg = None
        if measure.arg_field is not None:
            arg = self._base_column(
                self.dataset.dimensions.get(measure.arg_field), measure.arg_field
            )
        return self._aggregate_call(name, measure, target, arg)

    def _aggregate_call(self, name: str, measure: Measure, target: str, arg: str | None) -> str:
        """The aggregate function applied to already-resolved input SQL."""

        aggregation = measure.aggregation
        if aggregation in ("argMax", "argMin"):
            if arg is None:
                raise CompiledQueryError(
                    "internal", f'Measure "{name}" is {aggregation} without an arg field.'
                )
            return f"{aggregation}({target}, {arg})"
        if aggregation == "percentile":
            if measure.level is None:
                raise CompiledQueryError(
                    "internal", f'Measure "{name}" is a percentile with no level.'
                )
            # The level is a definition-time float the measure model already bounded
            # to [0, 1], not caller input, and ClickHouse takes it as a function
            # parameter rather than a bindable value.
            level = repr(measure.level)
            return f"quantile({level})({target})"
        functions = {
            "sum": "sum",
            "count": "count",
            "countDistinct": "uniqExact",
            "avg": "avg",
            "min": "min",
            "max": "max",
            "stddev": "stddevSamp",
            "variance": "varSamp",
        }
        function = functions.get(aggregation)
        if function is None:
            raise CompiledQueryError("internal", f"Unknown aggregation {aggregation!r}.")
        return f"{function}({target})"

    def _measure_filter_sql(self, name: str, measure: Measure) -> str:
        """A measure's own filters, as a conditional aggregate rather than a WHERE.

        A measure filter narrows that one measure; putting it in WHERE would narrow
        every other measure in the same statement too.
        """

        aggregate = self._aggregation_sql(name, measure)
        predicates = [
            self._filter_predicate(filter_value) for filter_value in measure.filters or ()
        ]
        return self._with_conditions(aggregate, predicates)

    @staticmethod
    def _with_conditions(aggregate: str, predicates: list[str]) -> str:
        """Apply predicates through ClickHouse's `-If` combinator."""

        if not predicates:
            return aggregate
        condition = " AND ".join(predicates)
        head, _, tail = aggregate.partition("(")
        return f"{head}If({tail[:-1]}, {condition})"

    def _relationship_measure_sql(self, name: str) -> str:
        """A target base aggregate over matched joined rows only.

        Every input is guarded by the match marker, so an unmatched base row
        keeps its own measures but contributes nothing to the target aggregate.
        The target measure's fixed filters narrow target columns, and the join
        carries the target's tenant predicate.
        """

        resolved = resolve_relationship_measure(self.dataset, name, registry=self.registry)
        target = resolved.target
        alias = self._ensure_relationship_join(
            resolved.relationship_name, resolved.relationship, target
        )
        marker = self.match_markers[resolved.relationship_name]
        matched = f"isNotNull({alias.sql}.{marker.sql})"

        def guarded(field: str) -> str:
            dimension = target.dimensions.get(field)
            column = dimension.column or field if dimension is not None else field
            return f"if({matched}, {alias.sql}.{safe_identifier(column, what='column').sql}, NULL)"

        measure = resolved.measure
        arg = guarded(measure.arg_field) if measure.arg_field is not None else None
        aggregate = self._aggregate_call(name, measure, guarded(measure.field), arg)
        predicates = [
            self._filter_predicate(
                Filter(
                    field=f"{resolved.relationship_name}."
                    f"{measure_filter_field(target, filter_value.field)}",
                    operator=filter_value.operator,
                    value=filter_value.value,
                )
            )
            for filter_value in measure.filters or ()
        ]
        return self._with_conditions(aggregate, predicates)

    def _add_measures(self, query: DatasetQuery) -> None:
        names = query.measures if query.measures is not None else tuple(self.dataset.measures)
        for name in names:
            if is_qualified(name):
                alias = SafeIdentifier(name)
                self.selections.append(aliased(self._relationship_measure_sql(name), alias))
                self.orderable[name] = alias
                continue
            measure = self.dataset.measures.get(name)
            if measure is None:
                known = ", ".join(sorted(self.dataset.measures)) or "(none)"
                raise CompiledQueryError(
                    "input-invalid",
                    f'Unknown measure "{name}" on dataset "{self.dataset.name}". '
                    f"Available: {known}",
                )
            alias = SafeIdentifier(name)
            self.selections.append(aliased(self._measure_filter_sql(name, measure), alias))
            self.orderable[name] = alias

    def _filter_type(self, field: str) -> str:
        """The ClickHouse type a filter on *field* binds as."""

        if is_qualified(field):
            resolved = resolve_qualified_field(self.dataset, field, registry=self.registry)
            return clickhouse_type_for(resolved.dimension.field_type)
        dimension = self.dataset.dimensions.get(field)
        # A filter on something with no declared type binds as a string: the widest
        # reading, and one the executor narrows once it knows the column.
        return "String" if dimension is None else clickhouse_type_for(dimension.field_type)

    def _filter_predicate(self, filter_value: Filter, *, request_filter: bool = False) -> str:
        """One predicate, with every value bound rather than written."""

        field = resolve_filter_field(self.dataset, filter_value.field)
        if is_qualified(field):
            resolved = resolve_qualified_field(self.dataset, field, registry=self.registry)
            dimension = resolved.dimension
            definition = resolved.target.filters.get(resolved.dimension_name)
            exposed = definition is not None and definition.field == resolved.dimension_name
        else:
            dimension = require_dimension(self.dataset, field)
            definition = self.dataset.filters.get(filter_value.field)
            exposed = definition is not None
        if request_filter:
            if not exposed:
                raise CompiledQueryError(
                    "input-invalid", f'Filter "{filter_value.field}" is not exposed by its dataset.'
                )
            if definition is not None and definition.operators is not None:
                if filter_value.operator not in definition.operators:
                    raise CompiledQueryError(
                        "input-invalid",
                        f'Filter "{filter_value.field}" does not allow {filter_value.operator}.',
                    )
        validate_filter_value(filter_value, dimension.field_type)
        column = self._field_sql(field)
        clickhouse_type = self._filter_type(field)
        operator = filter_value.operator
        what = f'filter "{filter_value.field}"'

        if operator in _ARRAY_OPERATORS:
            items = require_sequence(filter_value.value, what=what)
            if not items:
                raise CompiledQueryError("input-invalid", f"{what} needs at least one value")
            keyword = "IN" if operator == "in" else "NOT IN"
            placeholder = self.binder.bind_array(items, clickhouse_type)
            return f"{column} {keyword} {placeholder}"
        if operator == "between":
            items = require_sequence(filter_value.value, what=what)
            if len(items) != 2:
                raise CompiledQueryError("input-invalid", f"{what} needs exactly two values")
            lower = self.binder.bind(items[0], clickhouse_type)
            upper = self.binder.bind(items[1], clickhouse_type)
            return f"{column} BETWEEN {lower} AND {upper}"
        if operator == "like":
            text = require_scalar(filter_value.value, what=what)
            if type(text) is not str:
                raise CompiledQueryError("input-invalid", f"{what} needs a string value")
            placeholder = self.binder.bind(text, "String")
            return f"{column} LIKE {placeholder}"

        comparisons = {"eq": "=", "neq": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
        comparison = comparisons.get(operator)
        if comparison is None:
            raise CompiledQueryError("input-invalid", f"{what} uses unknown operator {operator!r}")
        placeholder = self.binder.bind(
            require_scalar(filter_value.value, what=what), clickhouse_type
        )
        return f"{column} {comparison} {placeholder}"

    def _filters_a_tenant_column(self, field: str) -> bool:
        """Whether *field* addresses the tenant column of the dataset that owns it.

        A relationship hop reaches another dataset's tenant column just as a base
        field reaches this one's, so the question is asked of whichever dataset the
        field resolves to rather than only of the base.
        """

        if is_qualified(field):
            resolved = resolve_qualified_field(self.dataset, field, registry=self.registry)
            if resolved.target.tenant_key is None:
                return False
            column = resolved.dimension.column or resolved.dimension_name
            return column == resolved.target.tenant_key
        if self.dataset.tenant_key is None:
            return False
        dimension = self.dataset.dimensions.get(field)
        column = dimension.column if dimension and dimension.column else field
        return column == self.dataset.tenant_key

    def _add_filters(self, query: DatasetQuery, scope: TenantScope | None) -> None:
        tenant_key = self.dataset.tenant_key
        for filter_value in query.filters:
            field = resolve_filter_field(self.dataset, filter_value.field)
            if scope is not None and self._filters_a_tenant_column(field):
                # Allowing this would let a caller narrow — or, with the wrong
                # operator, widen — the scope the server proved. On a joined target
                # the two predicates merely contradict and return nothing, which is
                # a worse answer than refusing: the caller cannot tell an empty
                # result from a request they were never allowed to make.
                raise CompiledQueryError(
                    "input-invalid",
                    f'Cannot filter on tenant field "{filter_value.field}" while runtime '
                    "tenant scoping is active.",
                )
            self.predicates.append(self._filter_predicate(filter_value, request_filter=True))

        if scope is not None and tenant_key is not None:
            # tenant_key names a physical source column. A dimension of the same
            # name may have a different column or SQL expression; never use it as
            # the authorization predicate.
            tenant_column = safe_identifier(tenant_key, what="tenant key").sql
            column = f"{BASE_ALIAS.sql}.{tenant_column}" if self.joins_active else tenant_column
            self.predicates.append(self._tenant_predicate(column, scope))

    def _add_order_by(self, query: DatasetQuery) -> list[str]:
        parts: list[str] = []
        for order in query.order_by:
            alias = self.orderable.get(order.field)
            if alias is None:
                known = ", ".join(sorted(self.orderable)) or "(none)"
                raise CompiledQueryError(
                    "input-invalid",
                    f'Cannot order by "{order.field}" because it is not selected. '
                    f"Available: {known}",
                )
            parts.append(f"{alias.sql} {'ASC' if order.direction == 'asc' else 'DESC'}")
        if not parts and query.by is not None:
            parts.append(f"{PERIOD_ALIAS.sql} ASC")
        return parts
