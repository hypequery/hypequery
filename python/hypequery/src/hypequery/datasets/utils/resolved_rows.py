"""The current-row predicate a resolved (FINAL) source keeps (RFC 0021)."""

from __future__ import annotations

from ..dataset import Dataset
from ..planner.identifiers import SafeIdentifier, safe_identifier


def current_row_predicate(dataset: Dataset, qualifier: SafeIdentifier) -> str | None:
    """`<qualifier>.<column> = 0|1` for the dataset's engine, or None.

    After FINAL, ClickHouse already drops rows its engine declares deleted; the
    predicate also covers deletion columns the engine does not declare, older
    servers and unmatched cancel rows. The column is a validated identifier and
    the value a constant, so nothing a caller sends reaches this text. It is
    qualified so an output alias of the same name cannot stand in for it.
    """

    policy = dataset.row_resolution
    current = None if policy is None else policy.current_row
    if current is None:
        return None
    column, value = current
    column_sql = safe_identifier(column, what="row resolution column").sql
    return f"{qualifier.sql}.{column_sql} = {value:d}"
