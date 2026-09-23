"""The semantic planner: a dataset query becomes a compiled query.

This is the only place a statement is built. It resolves every name against the
dataset, binds every value as a parameter, applies the tenant predicate the
context proves rather than one a caller asked for, and hands back a compiled
query whose SQL a request never authored.

Metrics and named queries are deliberately absent. The Python definition surface
has no metric handles and does not author named queries, so a planner branch for
either would be code with no way to reach it.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..dataset import Dataset
from ..dimensions import Dimension
from ..measures import Measure
from ..query_helpers import Filter
from ..registry import DatasetRegistry, create_dataset_registry
from .compiled_query import CompiledQuery, validate_correlation_id
from .context import ExecutionContext, TenantScope, effective_deadline
from .errors import CompiledQueryError
from .filter_validation import validate_filter_value
from .identifiers import SafeIdentifier, safe_identifier, safe_qualified_identifier
from .parameters import (
    ParameterBinder,
    clickhouse_type_for,
    require_scalar,
    require_sequence,
)
from .query import DatasetQuery
from .resolution import (
    is_qualified,
    require_dimension,
    resolve_filter_field,
    resolve_qualified_field,
)
from .settings import DEFAULT_QUERY_SETTINGS, QuerySettings
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

#: The alias a time-grain column is selected under.
PERIOD_ALIAS = SafeIdentifier("period")

#: The alias the base table takes when joins are active and its columns must be
#: qualified. Reserved: a dataset that declares a field by this name is refused
#: rather than silently shadowed.
BASE_ALIAS = SafeIdentifier("__hq_base")

_ARRAY_OPERATORS = frozenset(("in", "notIn"))


@dataclass(slots=True)
class _Plan:
    """The pieces of one statement, collected before they are joined."""

    dataset: Dataset
    registry: DatasetRegistry
    context: ExecutionContext
    binder: ParameterBinder
    selections: list[str]
    group_by: list[str]
    predicates: list[str]
    joins: list[str]
    joined: set[str]
    #: Set before anything is built. A base column is qualified only when a join
    #: could make it ambiguous, so a query that touches no relationship reads as
    #: it did before relationships existed.
    joins_active: bool
    #: Aliases a caller may order by: what this statement actually selects.
    orderable: dict[str, SafeIdentifier]


def _tenant_scope(dataset: Dataset, context: ExecutionContext) -> TenantScope | None:
    """The scope to enforce on *dataset*, refusing to serve it unscoped.

    A dataset declaring a tenant key is one whose rows belong to someone. Read
    without proof, every row is returned, so an absent scope fails closed here
    rather than at whatever reads the result.
    """

    if dataset.tenant_key is None:
        return None
    scope = context.tenant
    if scope is None:
        raise CompiledQueryError(
            "tenant-required",
            f'Dataset "{dataset.name}" requires runtime tenant scoping.',
        )
    return None if scope.cross_tenant else scope


def _tenant_predicate(plan: _Plan, column_sql: str, scope: TenantScope) -> str:
    """Bind the proven tenant identifiers as a parameter, never as text."""

    if len(scope.ids) == 1:
        placeholder = plan.binder.bind(scope.ids[0], "String")
        return f"{column_sql} = {placeholder}"
    placeholder = plan.binder.bind_array(scope.ids, "String")
    return f"{column_sql} IN {placeholder}"


def _base_column(plan: _Plan, dimension: Dimension | None, name: str) -> str:
    """The SQL for a base-dataset field: its trusted expression or its column."""

    if dimension is not None and dimension.sql is not None:
        if plan.joins_active:
            # A raw expression is written unqualified, so a bare `price` in it
            # could bind to a joined table's column instead of this one's.
            raise CompiledQueryError(
                "input-invalid",
                f'SQL-backed field "{name}" cannot be combined with relationship joins.',
            )
        return trusted_expression(dimension.sql)
    column = dimension.column if dimension is not None and dimension.column else name
    column_sql = safe_identifier(column, what="column").sql
    return f"{BASE_ALIAS.sql}.{column_sql}" if plan.joins_active else column_sql


def _ensure_join(plan: _Plan, name: str) -> tuple[str, SafeIdentifier]:
    """Add the LEFT JOIN a qualified field needs, once per relationship."""

    resolved = resolve_qualified_field(plan.dataset, name, registry=plan.registry)
    alias = safe_identifier(resolved.relationship_name, what="relationship name")
    if resolved.relationship_name not in plan.joined:
        plan.joined.add(resolved.relationship_name)
        target_source = safe_qualified_identifier(resolved.target.source, what="dataset source")
        left = safe_identifier(resolved.relationship.from_field, what="relationship from field")
        right = safe_identifier(resolved.relationship.to_field, what="relationship to field")
        condition = f"{BASE_ALIAS.sql}.{left.sql} = {alias.sql}.{right.sql}"
        # The joined dataset carries its own tenancy, so the predicate goes into
        # the join condition rather than WHERE: in a LEFT JOIN a WHERE predicate
        # on the right side would silently turn it into an inner join.
        target_scope = _tenant_scope(resolved.target, plan.context)
        if target_scope is not None and resolved.target.tenant_key is not None:
            tenant_column = safe_identifier(resolved.target.tenant_key, what="tenant key")
            condition += " AND " + _tenant_predicate(
                plan, f"{alias.sql}.{tenant_column.sql}", target_scope
            )
        plan.joins.append(f" LEFT JOIN {target_source.sql} AS {alias.sql} ON {condition}")
    column = resolved.dimension.column or resolved.dimension_name
    return f"{alias.sql}.{safe_identifier(column, what='column').sql}", alias


def _field_sql(plan: _Plan, name: str) -> str:
    """The SQL for any queryable field, base or relationship-qualified."""

    if is_qualified(name):
        expression, _ = _ensure_join(plan, name)
        return expression
    return _base_column(plan, plan.dataset.dimensions.get(name), name)


def _add_dimensions(plan: _Plan, query: DatasetQuery) -> None:
    if query.by is not None:
        if plan.dataset.time_key is None:
            raise CompiledQueryError(
                "input-invalid",
                f'Cannot group by time — dataset "{plan.dataset.name}" has no time key.',
            )
        time_column = _base_column(plan, None, plan.dataset.time_key)
        plan.selections.append(aliased(grain_expression(query.by, time_column), PERIOD_ALIAS))
        plan.group_by.append(PERIOD_ALIAS.sql)
        plan.orderable[PERIOD_ALIAS.name] = PERIOD_ALIAS

    for name in query.dimensions:
        if is_qualified(name):
            dimension = resolve_qualified_field(
                plan.dataset, name, registry=plan.registry
            ).dimension
            expression = _field_sql(plan, name)
        else:
            dimension = require_dimension(plan.dataset, name)
            expression = _field_sql(plan, name)
        if dimension.groupable is False:
            raise CompiledQueryError("input-invalid", f'Dimension "{name}" is not groupable.')
        # Every selection is aliased to the name the caller used, so grouping
        # and ordering reference one stable label whatever the expression is.
        alias = SafeIdentifier(name)
        plan.selections.append(aliased(expression, alias))
        plan.group_by.append(alias.sql)
        plan.orderable[name] = alias


def _aggregation_sql(plan: _Plan, name: str, measure: Measure) -> str:
    """The aggregate call for one measure, over its field or its trusted SQL."""

    if measure.sql is not None:
        if plan.joins_active:
            raise CompiledQueryError(
                "input-invalid",
                f'SQL-backed measure "{name}" cannot be combined with relationship joins.',
            )
        target = trusted_expression(measure.sql)
    else:
        target = _base_column(plan, plan.dataset.dimensions.get(measure.field), measure.field)

    aggregation = measure.aggregation
    if aggregation in ("argMax", "argMin"):
        if measure.arg_field is None:
            raise CompiledQueryError(
                "internal", f'Measure "{name}" is {aggregation} without an arg field.'
            )
        arg = _base_column(plan, plan.dataset.dimensions.get(measure.arg_field), measure.arg_field)
        return f"{aggregation}({target}, {arg})"
    if aggregation == "percentile":
        if measure.level is None:
            raise CompiledQueryError("internal", f'Measure "{name}" is a percentile with no level.')
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


def _measure_filter_sql(plan: _Plan, name: str, measure: Measure) -> str:
    """A measure's own filters, as a conditional aggregate rather than a WHERE.

    A measure filter narrows that one measure; putting it in WHERE would narrow
    every other measure in the same statement too.
    """

    aggregate = _aggregation_sql(plan, name, measure)
    if not measure.filters:
        return aggregate
    predicates = [_filter_predicate(plan, filter_value) for filter_value in measure.filters]
    condition = " AND ".join(predicates)
    head, _, tail = aggregate.partition("(")
    return f"{head}If({tail[:-1]}, {condition})"


def _add_measures(plan: _Plan, query: DatasetQuery) -> None:
    names = query.measures if query.measures is not None else tuple(plan.dataset.measures)
    for name in names:
        if is_qualified(name):
            raise CompiledQueryError(
                "input-invalid",
                f'Measure "{name}" is relationship-qualified. Measures are defined on the '
                f'base dataset "{plan.dataset.name}" only.',
            )
        measure = plan.dataset.measures.get(name)
        if measure is None:
            known = ", ".join(sorted(plan.dataset.measures)) or "(none)"
            raise CompiledQueryError(
                "input-invalid",
                f'Unknown measure "{name}" on dataset "{plan.dataset.name}". Available: {known}',
            )
        alias = SafeIdentifier(name)
        plan.selections.append(aliased(_measure_filter_sql(plan, name, measure), alias))
        plan.orderable[name] = alias


def _filter_type(plan: _Plan, field: str) -> str:
    """The ClickHouse type a filter on *field* binds as."""

    if is_qualified(field):
        resolved = resolve_qualified_field(plan.dataset, field, registry=plan.registry)
        return clickhouse_type_for(resolved.dimension.field_type)
    dimension = plan.dataset.dimensions.get(field)
    # A filter on something with no declared type binds as a string: the widest
    # reading, and one the executor narrows once it knows the column.
    return "String" if dimension is None else clickhouse_type_for(dimension.field_type)


def _filter_predicate(plan: _Plan, filter_value: Filter, *, request_filter: bool = False) -> str:
    """One predicate, with every value bound rather than written."""

    field = resolve_filter_field(plan.dataset, filter_value.field)
    if is_qualified(field):
        resolved = resolve_qualified_field(plan.dataset, field, registry=plan.registry)
        dimension = resolved.dimension
        definition = resolved.target.filters.get(resolved.dimension_name)
        exposed = definition is not None and definition.field == resolved.dimension_name
    else:
        dimension = require_dimension(plan.dataset, field)
        definition = plan.dataset.filters.get(filter_value.field)
        exposed = definition is not None
    if request_filter:
        if dimension.filterable is False:
            raise CompiledQueryError(
                "input-invalid", f'Filter "{filter_value.field}" is not filterable.'
            )
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
    column = _field_sql(plan, field)
    clickhouse_type = _filter_type(plan, field)
    operator = filter_value.operator
    what = f'filter "{filter_value.field}"'

    if operator in _ARRAY_OPERATORS:
        items = require_sequence(filter_value.value, what=what)
        if not items:
            raise CompiledQueryError("input-invalid", f"{what} needs at least one value")
        keyword = "IN" if operator == "in" else "NOT IN"
        placeholder = plan.binder.bind_array(items, clickhouse_type)
        return f"{column} {keyword} {placeholder}"
    if operator == "between":
        items = require_sequence(filter_value.value, what=what)
        if len(items) != 2:
            raise CompiledQueryError("input-invalid", f"{what} needs exactly two values")
        lower = plan.binder.bind(items[0], clickhouse_type)
        upper = plan.binder.bind(items[1], clickhouse_type)
        return f"{column} BETWEEN {lower} AND {upper}"
    if operator == "like":
        text = require_scalar(filter_value.value, what=what)
        if type(text) is not str:
            raise CompiledQueryError("input-invalid", f"{what} needs a string value")
        placeholder = plan.binder.bind(text, "String")
        return f"{column} LIKE {placeholder}"

    comparisons = {"eq": "=", "neq": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
    comparison = comparisons.get(operator)
    if comparison is None:
        raise CompiledQueryError("input-invalid", f"{what} uses unknown operator {operator!r}")
    placeholder = plan.binder.bind(require_scalar(filter_value.value, what=what), clickhouse_type)
    return f"{column} {comparison} {placeholder}"


def _add_filters(plan: _Plan, query: DatasetQuery, scope: TenantScope | None) -> None:
    tenant_key = plan.dataset.tenant_key
    for filter_value in query.filters:
        field = resolve_filter_field(plan.dataset, filter_value.field)
        if scope is not None and tenant_key is not None and not is_qualified(field):
            dimension = plan.dataset.dimensions.get(field)
            column = dimension.column if dimension and dimension.column else field
            if column == tenant_key:
                # Allowing this would let a caller narrow — or, with the wrong
                # operator, widen — the scope the server proved.
                raise CompiledQueryError(
                    "input-invalid",
                    f'Cannot filter on tenant field "{filter_value.field}" while runtime '
                    "tenant scoping is active.",
                )
        plan.predicates.append(_filter_predicate(plan, filter_value, request_filter=True))

    if scope is not None and tenant_key is not None:
        # tenant_key names a physical source column. A dimension of the same
        # name may have a different column or SQL expression; never use it as
        # the authorization predicate.
        tenant_column = safe_identifier(tenant_key, what="tenant key").sql
        column = f"{BASE_ALIAS.sql}.{tenant_column}" if plan.joins_active else tenant_column
        plan.predicates.append(_tenant_predicate(plan, column, scope))


def _add_order_by(plan: _Plan, query: DatasetQuery) -> list[str]:
    parts: list[str] = []
    for order in query.order_by:
        alias = plan.orderable.get(order.field)
        if alias is None:
            known = ", ".join(sorted(plan.orderable)) or "(none)"
            raise CompiledQueryError(
                "input-invalid",
                f'Cannot order by "{order.field}" because it is not selected. Available: {known}',
            )
        parts.append(f"{alias.sql} {'ASC' if order.direction == 'asc' else 'DESC'}")
    if not parts and query.by is not None:
        parts.append(f"{PERIOD_ALIAS.sql} ASC")
    return parts


def _check_limits(dataset: Dataset, query: DatasetQuery) -> None:
    limits = dataset.limits
    if limits is None:
        return
    if limits.max_dimensions is not None and len(query.dimensions) > limits.max_dimensions:
        raise CompiledQueryError(
            "too-large",
            f"Too many dimensions: {len(query.dimensions)} (max {limits.max_dimensions})",
        )
    measures = query.measures if query.measures is not None else tuple(dataset.measures)
    if limits.max_measures is not None and len(measures) > limits.max_measures:
        raise CompiledQueryError(
            "too-large", f"Too many measures: {len(measures)} (max {limits.max_measures})"
        )
    if limits.max_filters is not None and len(query.filters) > limits.max_filters:
        raise CompiledQueryError(
            "too-large", f"Too many filters: {len(query.filters)} (max {limits.max_filters})"
        )
    if (
        limits.max_result_size is not None
        and query.limit is not None
        and query.limit > limits.max_result_size
    ):
        raise CompiledQueryError(
            "too-large",
            f"Too many results requested: {query.limit} (max {limits.max_result_size})",
        )


def _references_a_relationship(dataset: Dataset, query: DatasetQuery) -> bool:
    """Whether anything in *query* addresses a field through a relationship."""

    names = [
        *query.dimensions,
        *(resolve_filter_field(dataset, item.field) for item in query.filters),
        *(order.field for order in query.order_by),
    ]
    return any(is_qualified(name) for name in names)


def _check_reserved_alias(dataset: Dataset) -> None:
    """Refuse a dataset whose own names would shadow the base alias."""

    for names in (dataset.dimensions, dataset.measures, dataset.relationships):
        if BASE_ALIAS.name in names:
            raise CompiledQueryError(
                "internal",
                f'Dataset "{dataset.name}" declares the reserved name "{BASE_ALIAS.name}".',
            )


def _check_admission(context: ExecutionContext) -> None:
    """Refuse to build an execution that is already over.

    Caller cancellation is checked first because it outranks a deadline that
    expired in the same moment: the caller stopped wanting the answer, which is
    a different fact from the answer taking too long.
    """

    if context.cancellation is not None and context.cancellation.is_set():
        raise CompiledQueryError("aborted", "The caller cancelled this execution.")
    if context.deadline is not None and context.deadline.expired():
        raise CompiledQueryError("deadline-exceeded", "The deadline passed before execution.")


def plan_dataset_query(
    dataset: Dataset,
    query: DatasetQuery | None = None,
    *,
    registry: DatasetRegistry | None = None,
    context: ExecutionContext | None = None,
    settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
) -> CompiledQuery:
    """Compile a semantic query over *dataset* into an executable statement.

    *registry* is only needed when the query traverses a relationship: a Python
    relationship stores its target's name, and the registry is what turns that
    name back into a dataset.
    """

    query = query or DatasetQuery()
    context = context or ExecutionContext()
    _check_admission(context)
    _check_limits(dataset, query)
    _check_reserved_alias(dataset)

    plan = _Plan(
        dataset=dataset,
        registry=registry or create_dataset_registry(dataset),
        context=context,
        binder=ParameterBinder(),
        selections=[],
        group_by=[],
        predicates=[],
        joins=[],
        joined=set(),
        joins_active=_references_a_relationship(dataset, query),
        orderable={},
    )
    scope = _tenant_scope(dataset, context)

    # Order matters: dimensions and measures register the joins and aliases that
    # filters and ordering resolve against.
    _add_dimensions(plan, query)
    _add_measures(plan, query)
    if not plan.selections:
        raise CompiledQueryError(
            "input-invalid",
            f'Dataset "{dataset.name}" query must select at least one dimension or measure.',
        )
    _add_filters(plan, query, scope)
    order_by = _add_order_by(plan, query)

    source = safe_qualified_identifier(dataset.source, what="dataset source")
    from_clause = f" FROM {source.sql}"
    if plan.joins_active:
        from_clause += f" AS {BASE_ALIAS.sql}"
    result_limit = query.limit
    if result_limit is None and dataset.limits is not None:
        result_limit = dataset.limits.max_result_size
    sql = (
        select_clause(plan.selections)
        + from_clause
        + "".join(plan.joins)
        + where_clause(plan.predicates)
        + group_by_clause(plan.group_by)
        + order_by_clause(order_by)
        + pagination_clause(result_limit, query.offset)
    )
    return CompiledQuery(
        sql=sql,
        parameters=plan.binder.parameters,
        operation="query",
        settings=settings,
        deadline=effective_deadline(context.deadline, settings.max_execution_time),
        correlation_id=validate_correlation_id(context.correlation_id),
    )
