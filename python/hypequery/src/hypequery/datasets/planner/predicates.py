"""Predicates shared by every statement the planner builds."""

from __future__ import annotations

from .context import TenantScope
from .parameters import ParameterBinder


def tenant_predicate(binder: ParameterBinder, column_sql: str, scope: TenantScope) -> str:
    """Restrict *column_sql* to the proven tenants, bound as a parameter, never as text."""

    dialect = binder.dialect
    if len(scope.ids) == 1:
        placeholder = binder.bind(scope.ids[0], dialect.scalar_type("String"))
        return f"{column_sql} = {placeholder}"
    placeholder = binder.bind_array(scope.ids, dialect.scalar_type("String"))
    return dialect.membership(column_sql, placeholder, negated=False)
