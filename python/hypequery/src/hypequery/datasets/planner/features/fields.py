"""Field SQL: base columns, trusted expressions, joined columns and time values."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from ...utils.query_timezone import time_filter_value
from ..aliases import BASE_ALIAS
from ..errors import CompiledQueryError
from ..identifiers import safe_identifier, safe_qualified_identifier
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
        column_sql = compiler.quote(
            safe_identifier(physical_column(compiler.dataset, name), what="column")
        )
        return f"{compiler.quote(BASE_ALIAS)}.{column_sql}" if compiler.joins_active else column_sql

    def field_sql(self, name: str) -> str:
        """The SQL for any queryable field, base or relationship-qualified."""

        if is_qualified(name):
            return self.compiler.joins.joined_column(name)
        return self.base_column(name)

    def zone_placeholder(self) -> str:
        """The query's zone, bound once however many expressions read it."""

        if self._timezone_placeholder is None:
            compiler = self.compiler
            self._timezone_placeholder = compiler.binder.bind(
                compiler.timezone, compiler.dialect.scalar_type("String")
            )
        return self._timezone_placeholder

    def time_sql(self, column: str) -> str:
        """*column* read as an instant in the query's zone."""

        return self.compiler.dialect.in_time_zone(column, self.zone_placeholder())

    def time_comparison(self, field: str) -> tuple[str, Callable[[str], str] | None]:
        """The column side and value spelling for comparing a time-key *field*.

        The probe reads the column's type without scanning the source: an
        uncorrelated zero-row subquery the server evaluates once.
        """

        compiler = self.compiler
        column = self.base_column(field)
        source = compiler.quote(
            safe_qualified_identifier(compiler.dataset.source, what="dataset source")
        )
        alias = f" AS {compiler.quote(BASE_ALIAS)}" if compiler.joins_active else ""
        # Every part is a validated identifier or trusted SQL; no value reaches it.
        probe = f"(SELECT {column} FROM {source}{alias} LIMIT 0)"  # noqa: S608
        return compiler.dialect.time_comparison(column, self.zone_placeholder(), probe)

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
        """The parameter type a filter on *field* binds as."""

        compiler = self.compiler
        if is_qualified(field):
            resolved = resolve_qualified_field(compiler.dataset, field, registry=compiler.registry)
            return compiler.dialect.parameter_type(resolved.dimension.field_type)
        dimension = compiler.dataset.dimensions.get(field)
        # A filter on something with no declared type binds as a string: the widest
        # reading, and one the executor narrows once it knows the column.
        if dimension is None:
            return compiler.dialect.parameter_type("string")
        return compiler.dialect.parameter_type(dimension.field_type)
