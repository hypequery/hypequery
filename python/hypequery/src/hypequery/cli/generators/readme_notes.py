"""README sections every scaffold ends with, whichever renderer builds it.

Schema-backed and framework READMEs rebuild most of the template, so a section
kept only in the template would reach the offline standalone example alone.
"""

from __future__ import annotations

CANCELLATION = """
## Timeouts and cancellation

Timeouts and cancelled requests stop their query with `KILL QUERY`. A
read-only ClickHouse user needs `GRANT SELECT ON system.processes TO <user>`
for that, or set `CLICKHOUSE_CONTROL_USERNAME` to a user that also has
`KILL QUERY` (see `.env.example`). Without either, the
`hypequery.execution.cancellation` logger reports it once, and timed-out
queries keep running, and keep a worker busy, until `max_execution_time`.
"""


def with_notes(readme: str) -> str:
    """*readme* ending with the sections every scaffold carries."""

    return readme.rstrip("\n") + "\n" + CANCELLATION
