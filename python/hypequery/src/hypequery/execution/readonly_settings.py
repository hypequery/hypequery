"""Explicit handling of the planner's readonly setting at the driver boundary.

The planner asks for ``readonly = 1`` on every query. A ClickHouse user whose
profile already sets ``readonly = 2`` may not change ``readonly`` at all, so
sending it made every query fail. When the driver reports that the connected
user is already read-only, the setting is redundant and is left out. Every
query limit is still sent: a limit is never silently dropped.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Literal, TypeAlias

from hypequery.datasets.planner import SETTING_DEFINITIONS, CompiledQueryError

from .errors import server_fault

ReadonlyPolicy: TypeAlias = Literal["query", "profile"]


def validate_readonly_policy(policy: ReadonlyPolicy) -> None:
    if policy not in ("query", "profile"):
        raise ValueError("readonly_policy must be 'query' or 'profile'")


def profile_readonly_level(client: object) -> str:
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

    level = profile_readonly_level(client)
    if policy == "query":
        return _without_readonly(settings) if level in ("1", "2") else dict(settings)

    if level not in ("1", "2"):
        raise server_fault(
            "HQ_EXECUTOR_READONLY_MISCONFIGURED",
            "readonly_policy='profile' requires a ClickHouse user whose profile enforces "
            "readonly = 1 or 2.",
            query_id,
        )
    return _without_readonly(settings)


# clickhouse-connect 1.6 says "is unknown or readonly"; later versions "is readonly".
_DRIVER_REFUSED = re.compile(r"^Setting (\w+) is (?:unknown or )?readonly$")
# The server's own wording for a readonly = 1 user, error code 164 READONLY.
_SERVER_REFUSED = re.compile(r"Cannot modify '(\w+)' setting in readonly mode")


def _refused_setting(exc: Exception) -> str | None:
    """The name of the setting ClickHouse or the driver refused, if that is the failure."""
    message = str(exc)
    driver = _DRIVER_REFUSED.match(message)
    if driver is not None:
        return driver.group(1)
    if getattr(exc, "name", None) == "READONLY":
        server = _SERVER_REFUSED.search(message)
        if server is not None:
            return server.group(1)
    return None


def readonly_setting_error(
    exc: Exception, policy: ReadonlyPolicy, query_id: str
) -> CompiledQueryError | None:
    """Give guidance only for rejection of HypeQuery's own settings.

    A user whose profile sets ``readonly = 1`` may not change any setting, so
    the planner's limits are refused one by one; that is the failure an
    operator can fix from the diagnostic alone. The refused setting's name is
    not echoed: the guidance is the same for all of them. It is the server's
    configuration that is wrong, so the caller sees only a server fault.
    """

    setting = _refused_setting(exc)
    if setting is None or setting not in SETTING_DEFINITIONS:
        return None
    if setting == "readonly":
        if policy != "query":
            return None
        return server_fault(
            "HQ_EXECUTOR_READONLY_MISCONFIGURED",
            "ClickHouse rejected HypeQuery's readonly setting. Use readonly_policy='profile' "
            "only when the ClickHouse user profile enforces readonly = 1 or 2.",
            query_id,
        )
    return server_fault(
        "HQ_EXECUTOR_READONLY_MISCONFIGURED",
        "ClickHouse rejected HypeQuery's per-query limits: the connected user is readonly = 1, "
        "which forbids changing any setting. Use a user whose profile sets readonly = 2 "
        "(settings may change, data may not).",
        query_id,
    )
