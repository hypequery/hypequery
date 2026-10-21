"""Refuse a stored value that cannot be the result of the query being served."""

from __future__ import annotations

from .store import CachedRows

_SCALARS = (str, int, float, bool, type(None))


def cached_rows_problem(value: object, columns: tuple[str, ...] | None) -> str | None:
    """Why *value* can't be served as these *columns*, or None when it can."""

    if type(value) is not CachedRows:
        return "the store returned something other than CachedRows"
    if type(value.columns) is not tuple or not all(type(name) is str for name in value.columns):
        return "cached columns are not a tuple of names"
    if columns is not None and value.columns != columns:
        return "cached columns differ from the query's columns"
    if type(value.rows) is not tuple:
        return "cached rows are not a tuple"
    width = len(value.columns)
    for row in value.rows:
        if type(row) is not tuple or len(row) != width:
            return "a cached row does not match the columns"
        if not all(isinstance(item, _SCALARS) for item in row):
            return "a cached row holds a value that is not a result scalar"
    return None
