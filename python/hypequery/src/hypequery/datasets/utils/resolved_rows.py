"""The current-row predicate a resolved (FINAL) source keeps (RFC 0021)."""

from __future__ import annotations

from ..dataset import Dataset
from ..planner.identifiers import safe_identifier


def current_row_predicate(dataset: Dataset) -> str | None:
    """`<column> = 0|1` for the dataset's engine, unqualified, or None.

    After FINAL, ClickHouse already drops rows its engine declares deleted; the
    predicate also covers deletion columns the engine does not declare, older
    servers and unmatched cancel rows. The column is a validated identifier and
    the value a constant, so nothing a caller sends reaches this text.
    """

    policy = dataset.row_resolution
    current = None if policy is None else policy.current_row
    if current is None:
        return None
    column, value = current
    return f"{safe_identifier(column, what='row resolution column').sql} = {value:d}"
