"""The database driver's loggers, and carrying their levels into a new process.

A development reload worker is a fresh process: logging set up by the command
that started it is gone, so levels it chose for these loggers are passed along.
"""

from __future__ import annotations

import logging

#: Loggers of clickhouse-connect and its HTTP pool. Their retry warnings can
#: carry bound parameter values (tenant ids, filter values).
DRIVER_LOGGERS = ("clickhouse_connect", "urllib3")


def driver_log_levels() -> dict[str, int]:
    """The levels set explicitly on the driver's loggers in this process."""

    levels = {name: logging.getLogger(name).level for name in DRIVER_LOGGERS}
    return {name: level for name, level in levels.items() if level != logging.NOTSET}


def apply_driver_log_levels(levels: object) -> None:
    """Set the driver's loggers to *levels*, ignoring anything that is not one."""

    if not isinstance(levels, dict):
        return
    for name in DRIVER_LOGGERS:
        level = levels.get(name)
        if type(level) is int:
            logging.getLogger(name).setLevel(level)
