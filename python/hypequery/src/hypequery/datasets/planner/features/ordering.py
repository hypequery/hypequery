"""Ordering and pagination over the selected outputs."""

from __future__ import annotations

from ..aliases import PERIOD_ALIAS
from ..errors import CompiledQueryError
from ..resolution import is_qualified
from .base import CompilerFeature


class OrderingFeature(CompilerFeature):
    """Orders by selected aliases only, then applies the effective row limit."""

    __slots__ = ()

    def add(self) -> None:
        compiler = self.compiler
        query, node, orderable = compiler.query, compiler.node, compiler.orderable
        for order in query.order_by:
            alias = orderable.get(order.field)
            if alias is None:
                known = ", ".join(sorted(orderable)) or "(none)"
                raise CompiledQueryError(
                    "input-invalid",
                    f'Cannot order by "{order.field}" because it is not selected. '
                    f"Available: {known}",
                )
            if order.field == PERIOD_ALIAS.name and compiler.period_bucket is not None:
                expression = compiler.period_bucket
            elif order.field in query.dimensions and is_qualified(order.field):
                expression = compiler.fields.field_sql(order.field)
            else:
                expression = compiler.quote(alias)
            node.order_by.append(
                compiler.dialect.order_term(expression, descending=order.direction == "desc")
            )
        if not node.order_by and compiler.period_bucket is not None:
            node.order_by.append(
                compiler.dialect.order_term(compiler.period_bucket, descending=False)
            )

    def paginate(self) -> None:
        """The query's limit, else the dataset's cap; one more row when probing."""

        compiler = self.compiler
        limit = compiler.query.limit
        if limit is None and compiler.dataset.limits is not None:
            limit = compiler.dataset.limits.max_result_size
        if compiler.overfetch and limit is not None:
            limit += 1
        compiler.node.limit = limit
        compiler.node.offset = compiler.query.offset
