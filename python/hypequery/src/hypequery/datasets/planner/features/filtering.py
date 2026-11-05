"""Row predicates: request filters, measure filters and the tenant boundary."""

from __future__ import annotations

from ...query_helpers import Filter
from ...utils.effective_filters import effective_filters
from ...utils.resolved_rows import current_row_predicate
from ..aliases import BASE_ALIAS
from ..context import TenantScope
from ..errors import CompiledQueryError
from ..filter_validation import validate_filter_value
from ..identifiers import safe_identifier
from ..operators import ARRAY_OPERATORS, COMPARISON_SQL, membership_keyword
from ..parameters import require_scalar, require_sequence
from ..predicates import tenant_predicate
from ..resolution import (
    is_qualified,
    physical_column,
    require_dimension,
    resolve_filter_field,
    resolve_qualified_field,
)
from .base import CompilerFeature


class FilterFeature(CompilerFeature):
    """Builds predicates with every value bound, and enforces the tenant scope."""

    __slots__ = ()

    def add(self, scope: TenantScope | None) -> None:
        """Add the request's filters, then the server-proven tenant predicate."""

        compiler = self.compiler
        dataset, where = compiler.dataset, compiler.node.where
        current = current_row_predicate(dataset)
        if current is not None:
            # Every other filter, the tenant's included, applies to current rows only.
            where.append(f"{BASE_ALIAS.sql}.{current}")
        for filter_value in compiler.query.filters:
            field = resolve_filter_field(dataset, filter_value.field)
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
            where.append(self.predicate(filter_value, request_filter=True))

        # Segments are the author's filters: the caller allow-list does not apply,
        # and each name is applied once, in the order first requested.
        for name in dict.fromkeys(compiler.query.segments):
            declared = dataset.segments.get(name)
            if declared is None:
                known = ", ".join(sorted(dataset.segments)) or "(none)"
                raise CompiledQueryError(
                    "input-invalid",
                    f'Unknown segment "{name}" on dataset "{dataset.name}". Available: {known}',
                )
            where.extend(self.predicate(item) for item in declared.filters)

        if scope is not None and dataset.tenant_key is not None:
            # tenant_key names a physical source column. A dimension of the same
            # name may have a different column or SQL expression; never use it as
            # the authorization predicate.
            tenant_column = safe_identifier(dataset.tenant_key, what="tenant key").sql
            column = f"{BASE_ALIAS.sql}.{tenant_column}"
            where.append(tenant_predicate(compiler.binder, column, scope))

    def predicate(self, filter_value: Filter, *, request_filter: bool = False) -> str:
        """One predicate, with every value bound rather than written."""

        compiler = self.compiler
        dataset, fields, binder = compiler.dataset, compiler.fields, compiler.binder
        field = resolve_filter_field(dataset, filter_value.field)
        if is_qualified(field):
            resolved = resolve_qualified_field(dataset, field, registry=compiler.registry)
            dimension = resolved.dimension
            definition = effective_filters(resolved.target).get(resolved.dimension_name)
            exposed = definition is not None and definition.field == resolved.dimension_name
        else:
            dimension = require_dimension(dataset, field)
            definition = effective_filters(dataset).get(filter_value.field)
            exposed = definition is not None
        if request_filter:
            if not exposed:
                raise CompiledQueryError(
                    "input-invalid", f'Filter "{filter_value.field}" is not exposed by its dataset.'
                )
            allowed = None if definition is None else definition.operators
            if (allowed is not None and filter_value.operator not in allowed) or (
                # Null checks are opt-in: the default allowlist never includes them.
                allowed is None and filter_value.is_null_check
            ):
                raise CompiledQueryError(
                    "input-invalid",
                    f'Filter "{filter_value.field}" does not allow {filter_value.operator}.',
                )
        validate_filter_value(filter_value, dimension.field_type)
        column = fields.field_sql(field)
        if filter_value.is_null_check:
            # No value is read, so a time key is not converted to the query timezone.
            keyword = "IS NULL" if filter_value.operator == "isNull" else "IS NOT NULL"
            return f"{column} {keyword}"
        if fields.is_time_field(field):
            column = fields.time_sql(column)
        clickhouse_type = fields.filter_type(field)
        operator = filter_value.operator
        what = f'filter "{filter_value.field}"'

        if operator in ARRAY_OPERATORS:
            items = require_sequence(filter_value.value, what=what)
            if not items:
                raise CompiledQueryError("input-invalid", f"{what} needs at least one value")
            placeholder = binder.bind_array(
                [fields.filter_bound(field, bound) for bound in items], clickhouse_type
            )
            return f"{column} {membership_keyword(operator)} {placeholder}"
        if operator == "between":
            items = require_sequence(filter_value.value, what=what)
            if len(items) != 2:
                raise CompiledQueryError("input-invalid", f"{what} needs exactly two values")
            lower = binder.bind(fields.filter_bound(field, items[0]), clickhouse_type)
            upper = binder.bind(fields.filter_bound(field, items[1]), clickhouse_type)
            return f"{column} BETWEEN {lower} AND {upper}"
        if operator == "like":
            text = require_scalar(filter_value.value, what=what)
            if type(text) is not str:
                raise CompiledQueryError("input-invalid", f"{what} needs a string value")
            placeholder = binder.bind(text, "String")
            return f"{column} LIKE {placeholder}"

        comparison = COMPARISON_SQL.get(operator)
        if comparison is None:
            raise CompiledQueryError("input-invalid", f"{what} uses unknown operator {operator!r}")
        placeholder = binder.bind(
            fields.filter_bound(field, require_scalar(filter_value.value, what=what)),
            clickhouse_type,
        )
        return f"{column} {comparison} {placeholder}"

    def _filters_a_tenant_column(self, field: str) -> bool:
        """Whether *field* addresses the tenant column of the dataset that owns it.

        A relationship hop reaches another dataset's tenant column just as a base
        field reaches this one's, so the question is asked of whichever dataset the
        field resolves to rather than only of the base.
        """

        compiler = self.compiler
        if is_qualified(field):
            resolved = resolve_qualified_field(compiler.dataset, field, registry=compiler.registry)
            if resolved.target.tenant_key is None:
                return False
            return (
                physical_column(resolved.target, resolved.dimension_name)
                == resolved.target.tenant_key
            )
        if compiler.dataset.tenant_key is None:
            return False
        return physical_column(compiler.dataset, field) == compiler.dataset.tenant_key
