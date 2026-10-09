"""A metric endpoint's public name for the one measure it serves.

A metric may be published under a name other than its measure's. Callers order
by and read that public name; the planner knows only the measure. This maps the
one to the other in both directions.
"""

from __future__ import annotations

from dataclasses import dataclass

from ...datasets.planner import DatasetQuery
from ...datasets.query_helpers import Order

ResponseRow = dict[str, str | int | float | bool | None]


@dataclass(frozen=True, slots=True)
class MetricAlias:
    measure: str
    name: str

    def query(self, query: DatasetQuery) -> DatasetQuery:
        """*query* with orderings on the public name moved to the measure."""

        orders = tuple(
            Order(
                field=self.measure if order.field == self.name else order.field,
                direction=order.direction,
            )
            for order in query.order_by
        )
        return query.model_copy(update={"order_by": orders})

    def rows(self, rows: list[ResponseRow]) -> list[ResponseRow]:
        """Result rows with the measure's column under the public name."""

        if self.name == self.measure:
            return rows
        return [
            {self.name if key == self.measure else key: value for key, value in row.items()}
            for row in rows
        ]
