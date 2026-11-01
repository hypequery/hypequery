"""The filters a caller may apply to a dataset (RFC 0024)."""

from __future__ import annotations

from collections.abc import Mapping

from ..dataset import Dataset, FilterDefinition


def effective_filters(dataset: Dataset) -> Mapping[str, FilterDefinition]:
    """The declared filters, plus one per filterable dimension none is named after.

    Declared filters add to the dimensions marked filterable rather than
    replacing them. A declared filter keeps its own name, field and operators,
    and can expose a dimension marked ``filterable=False``. A dimension's own
    filter takes the operators of the declared filters on its field, so naming
    the dimension directly cannot bypass a declared narrowing. Without one it
    gets the default list. Mirrors TypeScript's ``effectiveFilters``.
    """

    filters: dict[str, FilterDefinition] = dict(dataset.filters)
    for name, dimension in dataset.dimensions.items():
        if dimension.filterable is False or name in filters:
            continue
        declared = [item for item in dataset.filters.values() if item.field == name]
        operators = None
        if declared and all(item.operators is not None for item in declared):
            operators = tuple(dict.fromkeys(op for item in declared for op in item.operators or ()))
        filters[name] = FilterDefinition(field=name, operators=operators)
    return filters
