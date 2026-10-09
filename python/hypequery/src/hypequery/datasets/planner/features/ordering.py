"""Ordering and pagination over the selected outputs."""

from __future__ import annotations

from ..aliases import PERIOD_ALIAS
from ..errors import CompiledQueryError
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
            node.order_by.append(f"{alias.sql} {'ASC' if order.direction == 'asc' else 'DESC'}")
        if not node.order_by and query.by is not None:
            node.order_by.append(f"{PERIOD_ALIAS.sql} ASC")

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
