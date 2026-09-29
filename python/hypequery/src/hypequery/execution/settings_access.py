"""Which planner settings a ClickHouse user may actually send.

ClickHouse refuses a per-query setting the user may not change unless its
value already matches: under ``readonly = 1`` that is every setting, and under
``readonly = 2`` it is ``readonly`` itself (measured against ClickHouse 26.9).
clickhouse-connect raises on such a setting by default, so sending the
planner's full map made every query fail for those users.

The driver already reads ``system.settings`` for the connected user, so the
executor sends only what the user may change and warns once about any limit it
had to leave to the user's profile. Dropping ``readonly`` never weakens
anything: the server only marks it unchangeable when the user is read-only.
"""

from __future__ import annotations

import logging
from collections.abc import Collection, Mapping
from dataclasses import dataclass

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class SettingsAccess:
    """The planner settings to send, and those left to the user's profile."""

    sendable: Mapping[str, int]
    left_to_profile: tuple[str, ...]


def settings_access(client: object, settings: Mapping[str, int]) -> SettingsAccess:
    """Split *settings* by whether the connected user may change them.

    A client without ``server_settings`` (a test fake, or a driver that does
    not expose it) keeps the previous behaviour: everything is sent.
    """

    server = getattr(client, "server_settings", None)
    if not isinstance(server, Mapping):
        return SettingsAccess(sendable=dict(settings), left_to_profile=())

    sendable: dict[str, int] = {}
    left_to_profile: list[str] = []
    for name, value in settings.items():
        definition = server.get(name)
        if definition is None or not int(getattr(definition, "readonly", 0) or 0):
            sendable[name] = value
        elif str(getattr(definition, "value", "")) != str(value) and name != "readonly":
            left_to_profile.append(name)
    return SettingsAccess(sendable=sendable, left_to_profile=tuple(left_to_profile))


def warn_left_to_profile(names: Collection[str]) -> None:
    """Log newly blocked limits that the user's profile must enforce instead."""

    if names:
        _LOGGER.warning(
            "This ClickHouse user cannot change %s (readonly = 1), so hypequery does not "
            "apply those limits; only the user's profile does. Set them in the profile, "
            "or use a readonly = 2 user to keep them.",
            ", ".join(sorted(names)),
        )
