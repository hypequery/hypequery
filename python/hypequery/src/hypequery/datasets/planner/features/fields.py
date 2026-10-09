"""Field SQL: base columns, trusted expressions, joined columns and time values."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ...utils.query_timezone import time_filter_value
from ..aliases import BASE_ALIAS
from ..errors import CompiledQueryError
from ..identifiers import safe_identifier
from ..parameters import clickhouse_type_for
from ..resolution import is_qualified, physical_column, resolve_qualified_field
from ..sql_fragments import trusted_expression
from .base import CompilerFeature

if TYPE_CHECKING:
    from ..compiler import DatasetQueryCompiler


class FieldFeature(CompilerFeature):
    """The SQL each queryable field reads, and how its filter values bind."""

    __slots__ = ("_timezone_placeholder",)

    def __init__(self, compiler: DatasetQueryCompiler) -> None:
        super().__init__(compiler)
        self._timezone_placeholder: str | None = None

    def base_column(self, name: str) -> str:
        """The SQL for a base-dataset field: its trusted expression or its column."""

        compiler = self.compiler
        dimension = compiler.dataset.dimensions.get(name)
        if dimension is not None and dimension.sql is not None:
            if compiler.joins_active:
                # A raw expression is written unqualified, so a bare `price` in it
                # could bind to a joined table's column instead of this one's.
                raise CompiledQueryError(
                    "input-invalid",
                    f'SQL-backed field "{name}" cannot be combined with relationship joins.',
                )
            return trusted_expression(dimension.sql)
        column_sql = safe_identifier(physical_column(compiler.dataset, name), what="column").sql
        return f"{BASE_ALIAS.sql}.{column_sql}" if compiler.joins_active else column_sql

    def field_sql(self, name: str) -> str:
        """The SQL for any queryable field, base or relationship-qualified."""

        if is_qualified(name):
            return self.compiler.joins.joined_column(name)
        return self.base_column(name)

    def time_sql(self, column: str) -> str:
        """*column* read as an instant in the query's zone, which is bound once."""

        if self._timezone_placeholder is None:
            self._timezone_placeholder = self.compiler.binder.bind(self.compiler.timezone, "String")
        return f"toDateTime64({column}, 9, {self._timezone_placeholder})"

    def is_time_field(self, field: str) -> bool:
        """Whether *field* reads the dataset's time key column."""

        dataset = self.compiler.dataset
        if is_qualified(field) or dataset.time_key is None:
            return False
        return physical_column(dataset, field) == physical_column(dataset, dataset.time_key)

    def filter_bound(self, field: str, bound: object) -> object:
        """A filter value, with an offset-free time-key bound read in the query zone."""

        if self.is_time_field(field):
            return time_filter_value(bound, self.compiler.timezone)
        return bound

    def filter_type(self, field: str) -> str:
        """The ClickHouse type a filter on *field* binds as."""

        compiler = self.compiler
        if is_qualified(field):
            resolved = resolve_qualified_field(compiler.dataset, field, registry=compiler.registry)
            return clickhouse_type_for(resolved.dimension.field_type)
        dimension = compiler.dataset.dimensions.get(field)
        # A filter on something with no declared type binds as a string: the widest
        # reading, and one the executor narrows once it knows the column.
        return "String" if dimension is None else clickhouse_type_for(dimension.field_type)
