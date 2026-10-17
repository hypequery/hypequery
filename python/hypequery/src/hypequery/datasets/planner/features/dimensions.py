"""Grouping selections: the time bucket and the requested dimensions."""

from __future__ import annotations

from ..aliases import PERIOD_ALIAS
from ..errors import CompiledQueryError
from ..identifiers import SafeIdentifier
from ..resolution import is_qualified, require_dimension, resolve_qualified_field
from ..sql_fragments import aliased
from .base import CompilerFeature


class DimensionFeature(CompilerFeature):
    """Selects and groups by the time bucket and each requested dimension."""

    __slots__ = ()

    def add(self) -> None:
        compiler = self.compiler
        dataset, query, node = compiler.dataset, compiler.query, compiler.node
        if query.by is not None:
            if dataset.time_key is None:
                raise CompiledQueryError(
                    "input-invalid",
                    f'Cannot group by time — dataset "{dataset.name}" has no time key.',
                )
            fields, dialect = compiler.fields, compiler.dialect
            time_column = fields.time_sql(fields.base_column(dataset.time_key))
            bucket = dialect.truncate_to_grain(query.by, time_column)
            # Group on the bucket itself; only the selected value is text.
            node.selections.append(aliased(dialect.period_text(bucket), PERIOD_ALIAS))
            node.group_by.append(bucket)
            compiler.orderable[PERIOD_ALIAS.name] = PERIOD_ALIAS

        for name in query.dimensions:
            if is_qualified(name):
                dimension = resolve_qualified_field(
                    dataset, name, registry=compiler.registry
                ).dimension
            else:
                dimension = require_dimension(dataset, name)
            expression = compiler.fields.field_sql(name)
            if dimension.groupable is False:
                raise CompiledQueryError("input-invalid", f'Dimension "{name}" is not groupable.')
            # A qualified alias can also resolve to the physical joined column.
            # Group its guarded expression so the match marker remains part of
            # the key, independently of ClickHouse alias-resolution settings.
            alias = SafeIdentifier(name)
            node.selections.append(aliased(expression, alias))
            node.group_by.append(expression if is_qualified(name) else alias.sql)
            compiler.orderable[name] = alias
