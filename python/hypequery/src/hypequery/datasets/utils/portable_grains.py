"""Time grains the published deployment contract can carry.

``minute`` and ``hour`` run locally, but deployment contract 2 only carries
day-through-year grains (RFC 0015). A dataset restricted to fewer of those
grains cannot be published without silently widening it, so it is refused.
Matches TypeScript's ``utils/portable-grains.ts``.
"""

from __future__ import annotations

from typing import Final

#: Grains deployment contract 2 carries, in ascending order.
PORTABLE_TIME_GRAINS: Final[tuple[str, ...]] = ("day", "week", "month", "quarter", "year")


def assert_publishable_time_grains(name: str, time_grains: tuple[str, ...] | None) -> None:
    """Refuse a dataset-level grain restriction contract 2 cannot preserve."""
    if time_grains is None:
        return
    missing = [grain for grain in PORTABLE_TIME_GRAINS if grain not in time_grains]
    if missing:
        raise ValueError(
            f'Dataset "{name}" time_grains excludes {", ".join(missing)}, but deployment '
            "contract 2 cannot preserve dataset-level grain restrictions. Use all "
            "day-through-year grains or keep this dataset local."
        )


def unsupported_time_grain_error(supported: tuple[str, ...], grain: str) -> str | None:
    """The validation message for a grain outside *supported*, matching TypeScript."""
    if grain in supported:
        return None
    return f'Unsupported time grain "{grain}". Supported: {", ".join(supported)}'
