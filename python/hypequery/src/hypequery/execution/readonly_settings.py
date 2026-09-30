"""Explicit handling of the planner's readonly setting at the driver boundary."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, TypeAlias

from hypequery.datasets.planner import CompiledQueryError

ReadonlyPolicy: TypeAlias = Literal["query", "profile"]


def validate_readonly_policy(policy: ReadonlyPolicy) -> None:
    if policy not in ("query", "profile"):
        raise ValueError("readonly_policy must be 'query' or 'profile'")


def wire_settings(
    client: object,
    settings: Mapping[str, int],
    policy: ReadonlyPolicy,
    query_id: str,
) -> dict[str, int]:
    """Omit only readonly in profile mode; never discard planner limits."""

    if policy == "query":
        return dict(settings)

    server = getattr(client, "server_settings", None)
    definition = server.get("readonly") if isinstance(server, Mapping) else None
    if str(getattr(definition, "value", "")) not in ("1", "2"):
        raise CompiledQueryError(
            "forbidden",
            "readonly_policy='profile' requires a ClickHouse user whose profile enforces "
            "readonly = 1 or 2.",
            query_id=query_id,
        )
    return {name: value for name, value in settings.items() if name != "readonly"}


def readonly_setting_error(
    exc: Exception, policy: ReadonlyPolicy, query_id: str
) -> CompiledQueryError | None:
    """Give guidance only for rejection of HypeQuery's own readonly setting."""

    if policy != "query":
        return None
    message = str(exc)
    driver_rejected_setting = message.startswith("Setting readonly is unknown or readonly")
    server_rejected_setting = getattr(exc, "name", None) == "READONLY" and "'readonly'" in message
    if not (driver_rejected_setting or server_rejected_setting):
        return None
    return CompiledQueryError(
        "forbidden",
        "ClickHouse rejected HypeQuery's readonly setting. Use readonly_policy='profile' "
        "only when the ClickHouse user profile enforces readonly = 1 or 2.",
        query_id=query_id,
    )
