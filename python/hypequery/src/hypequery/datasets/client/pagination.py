"""Page sizing for paginated executions.

A paginated execution fetches one row beyond the page to learn whether another
page exists, so the page must leave room for that probe under the effective
`max_result_rows` setting.
"""

from __future__ import annotations

from typing import Final

from ..planner import CompiledQueryError

#: The page size when neither the request nor the dataset sets a smaller one.
DEFAULT_PAGE_SIZE: Final = 1000


def page_limit(requested: int | None, dataset_cap: int | None, max_result_rows: int) -> int:
    """The rows one page returns, leaving room for the probe row.

    An omitted limit takes the smaller of the dataset cap and the default page
    size. Every limit is then held under `max_result_rows - 1`.
    """

    limit = requested
    if limit is None:
        limit = min(
            dataset_cap if dataset_cap is not None else DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE
        )
    ceiling = max_result_rows - 1
    if ceiling < 1:
        raise CompiledQueryError("too-large", "Pagination requires room for a probe row.")
    return min(limit, ceiling)
