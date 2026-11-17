"""Time grains the published deployment contract can carry.

Contract 2 carries ``day`` through ``year``; contract 3 (RFC 0015) adds
``minute`` and ``hour``. No deployment contract carries a dataset-level grain
restriction, and a published dataset accepts every grain, so a restriction that
omits any grain is refused rather than silently widened. Matches TypeScript's
``utils/portable-grains.ts``.
"""

from __future__ import annotations

from typing import Final

from ..constants import SUPPORTED_TIME_GRAINS

#: Grains deployment contract 2 carries, in ascending order.
PORTABLE_TIME_GRAINS: Final[tuple[str, ...]] = ("day", "week", "month", "quarter", "year")


def assert_publishable_time_grains(name: str, time_grains: tuple[str, ...] | None) -> None:
    """Refuse a dataset-level grain restriction no deployment contract can preserve."""
    if time_grains is None:
        return
    missing = [grain for grain in SUPPORTED_TIME_GRAINS if grain not in time_grains]
    if missing:
        raise ValueError(
            f'Dataset "{name}" time_grains excludes {", ".join(missing)}, but deployment '
            "contracts cannot preserve dataset-level grain restrictions, and a published "
            "dataset accepts every grain. Remove time_grains to publish it, or keep this "
            "dataset local."
        )


def unsupported_time_grain_error(supported: tuple[str, ...], grain: str) -> str | None:
    """The validation message for a grain outside *supported*, matching TypeScript."""
    if grain in supported:
        return None
    return f'Unsupported time grain "{grain}". Supported: {", ".join(supported)}'
