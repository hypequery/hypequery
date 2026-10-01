"""Explicit handling of the planner's readonly setting at the driver boundary.

The planner asks for ``readonly = 1`` on every query. A ClickHouse user whose
profile already sets ``readonly = 2`` may not change ``readonly`` at all, so
sending it made every query fail. When the driver reports that the connected
user is already read-only, the setting is redundant and is left out. Every
query limit is still sent: a limit is never silently dropped.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, TypeAlias

from hypequery.datasets.planner import CompiledQueryError

ReadonlyPolicy: TypeAlias = Literal["query", "profile"]


def validate_readonly_policy(policy: ReadonlyPolicy) -> None:
    if policy not in ("query", "profile"):
        raise ValueError("readonly_policy must be 'query' or 'profile'")


def _profile_readonly_level(client: object) -> str:
    """The connected user's readonly level from the driver's system.settings, or ""."""

    server = getattr(client, "server_settings", None)
    definition = server.get("readonly") if isinstance(server, Mapping) else None
    return str(getattr(definition, "value", ""))


def _without_readonly(settings: Mapping[str, int]) -> dict[str, int]:
    return {name: value for name, value in settings.items() if name != "readonly"}


def wire_settings(
    client: object,
    settings: Mapping[str, int],
    policy: ReadonlyPolicy,
    query_id: str,
) -> dict[str, int]:
    """Omit readonly only for a user already read-only; never discard planner limits.

    In ``query`` mode a user the driver reports as ``readonly = 1`` or ``2`` is
    already read-only, so the planner's ``readonly`` is left out (a
    ``readonly = 2`` user would refuse it). Any other user gets every setting.
    ``profile`` mode additionally refuses a user that is not read-only.
    """

    level = _profile_readonly_level(client)
    if policy == "query":
        return _without_readonly(settings) if level in ("1", "2") else dict(settings)

    if level not in ("1", "2"):
        raise CompiledQueryError(
            "forbidden",
            "readonly_policy='profile' requires a ClickHouse user whose profile enforces "
            "readonly = 1 or 2.",
            query_id=query_id,
        )
    return _without_readonly(settings)


def readonly_setting_error(
    exc: Exception, policy: ReadonlyPolicy, query_id: str
) -> CompiledQueryError | None:
    """Give guidance only for rejection of HypeQuery's own readonly setting.

    Reached only when the driver could not report the user's readonly level, so
    the planner's ``readonly`` was sent and refused.
    """

    if policy != "query":
        return None
    message = str(exc)
    # clickhouse-connect 1.6 says "is unknown or readonly"; later versions "is readonly".
    driver_rejected_setting = message in (
        "Setting readonly is unknown or readonly",
        "Setting readonly is readonly",
    )
    server_rejected_setting = getattr(exc, "name", None) == "READONLY" and "'readonly'" in message
    if not (driver_rejected_setting or server_rejected_setting):
        return None
    return CompiledQueryError(
        "forbidden",
        "ClickHouse rejected HypeQuery's readonly setting. Use readonly_policy='profile' "
        "only when the ClickHouse user profile enforces readonly = 1 or 2.",
        query_id=query_id,
    )
