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


#: What `init --framework` writes besides hypequery's own API, and how each runs.
_OWN_SERVERS = (
    "uvicorn app:app --reload for FastAPI, flask --app app run for Flask, or "
    "python manage.py runserver for Django"
)


def app_start_failure(exc: BaseException) -> str:
    """A safe message for an app that failed to start, never echoing the error itself.

    ``run_dev`` refuses an import string that names anything but hypequery's own
    API, such as the FastAPI, Flask or Django app ``init --framework`` writes: those
    run under their own servers, so say which.
    """

    if isinstance(exc, TypeError) and str(exc).startswith("run_dev requires an Api"):
        return (
            "dev serves hypequery's own API (create_api or to_asgi_app). Run this app with "
            f"its own server instead: {_OWN_SERVERS}."
        )
    return "App could not start; check its code, dependencies and environment."


def quiet_driver_warnings() -> None:
    """Keep driver warnings out of the terminal; their errors still show.

    They repeat what the CLI's own hint says. Reload workers inherit the levels.
    """

    for name in DRIVER_LOGGERS:
        logging.getLogger(name).setLevel(logging.ERROR)
