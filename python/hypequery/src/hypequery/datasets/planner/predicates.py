"""Predicates shared by every statement the planner builds."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .context import TenantScope
from .parameters import ParameterBinder

if TYPE_CHECKING:
    from ..dataset import Dataset


def joins_within_tenant(base: Dataset, target: Dataset, scope: TenantScope | None) -> bool:
    """Whether a join from *base* to *target* must also match their tenant keys.

    One tenant pins both sides to the same id already. A scope over several
    tenants, or all of them, admits every scoped tenant's target rows, so a key
    reused across tenants would otherwise match another tenant's row.
    """

    if base.tenant_key is None or target.tenant_key is None or scope is None:
        return False
    return scope.cross_tenant or len(scope.ids) > 1


def tenant_predicate(binder: ParameterBinder, column_sql: str, scope: TenantScope) -> str:
    """Restrict *column_sql* to the proven tenants, bound as a parameter, never as text."""

    if len(scope.ids) == 1:
        placeholder = binder.bind(scope.ids[0], "String")
        return f"{column_sql} = {placeholder}"
    placeholder = binder.bind_array(scope.ids, "String")
    return f"{column_sql} IN {placeholder}"
