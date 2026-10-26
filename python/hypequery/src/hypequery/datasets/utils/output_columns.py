"""The columns a planned query returns, in the order the planner selects them."""

from __future__ import annotations

from ..dataset import Dataset
from ..planner.query import DatasetQuery
from ..planner.resolution import selected_measure_names


def output_columns(dataset: Dataset, query: DatasetQuery) -> tuple[str, ...]:
    """``period`` when bucketing by time, then the dimensions, then the measures."""

    period = ("period",) if query.by is not None else ()
    return (*period, *query.dimensions, *selected_measure_names(dataset, query))
