"""Per-query settings as a trailing ``SETTINGS`` clause, for engines without a settings API.

chDB takes no settings argument, so the planner's limits travel in the
statement. Every name is a fixed identifier and every value either a
validated integer or a fixed literal: nothing a caller supplied reaches it.
``readonly`` comes last so no setting in the clause is applied after the
query became read-only.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping

#: A trailing clause the planner wrote, such as the one a resolved (FINAL) read pins.
#: Planner SQL carries no caller text, so only planner-built settings can match.
_TRAILING_SETTINGS = re.compile(r" SETTINGS ([a-z_]+ = [0-9]+(?:, [a-z_]+ = [0-9]+)*)$")


def settings_clause(limits: Mapping[str, int], output: Mapping[str, str]) -> str:
    """`` SETTINGS name = value, ...`` with *output* first and ``readonly`` last."""

    ordered = [
        *output.items(),
        *((name, str(value)) for name, value in limits.items() if name != "readonly"),
        *(("readonly", str(value)) for name, value in limits.items() if name == "readonly"),
    ]
    return " SETTINGS " + ", ".join(f"{name} = {value}" for name, value in ordered)


def with_settings(sql: str, limits: Mapping[str, int], output: Mapping[str, str]) -> str:
    """*sql* with the executor's settings, in one clause even when the planner wrote one.

    ClickHouse accepts a single ``SETTINGS`` clause, so the planner's settings
    come first and the executor's follow, ``readonly`` still last.
    """

    clause = settings_clause(limits, output)
    planned = _TRAILING_SETTINGS.search(sql)
    if planned is None:
        return sql + clause
    return (
        f"{sql[: planned.start()]} SETTINGS {planned.group(1)}, {clause.removeprefix(' SETTINGS ')}"
    )


def within_deadline(limits: Mapping[str, int], remaining: float | None) -> dict[str, int]:
    """*limits* with ``max_execution_time`` no later than the caller's deadline.

    An engine that cannot be told to stop a query ends it only at its own time
    limit, so that limit is brought forward to the deadline, never past it.
    """

    if remaining is None:
        return dict(limits)
    bounded = min(limits["max_execution_time"], math.ceil(remaining))
    return {**limits, "max_execution_time": max(1, bounded)}
