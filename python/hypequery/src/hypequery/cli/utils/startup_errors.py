"""Startup failures of a user app, described without echoing anything secret."""

from __future__ import annotations

import logging
import re

from hypequery.execution.utils.driver_loggers import DRIVER_LOGGERS

_ENV_NAME = re.compile(r"[A-Z][A-Z0-9_]{1,99}\Z")


def missing_environment_variable(exc: BaseException) -> str | None:
    """The variable an ``os.environ[...]`` lookup failed on, if it looks like one."""

    if type(exc) is not KeyError or len(exc.args) != 1:
        return None
    name = exc.args[0]
    return name if isinstance(name, str) and _ENV_NAME.fullmatch(name) else None


def quiet_driver_warnings() -> None:
    """Keep driver warnings out of the terminal; their errors still show.

    They repeat what the CLI's own hint says. Reload workers inherit the levels.
    """

    for name in DRIVER_LOGGERS:
        logging.getLogger(name).setLevel(logging.ERROR)
