"""One ``python_cli_command_completed`` event per invocation, best-effort.

Nothing here may change a command's output, exit code or exceptions: every
telemetry step swallows its own failures.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from collections.abc import Mapping, Sequence
from contextvars import ContextVar
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from .catalog import COMPLETED_EVENT, validate_event
from .environment import collect_environment
from .invocation import (
    flags_used,
    has_unknown_option,
    help_topic,
    requested_command,
    suggested_command,
)
from .opt_out import resolve_state
from .project import project_id
from .settings import SettingsStore, config_directory
from .transport import DEFAULT_ENDPOINT, dispatch, telemetry_endpoint, wire_event

TELEMETRY_DOCS_URL = "https://hypequery.com/docs/telemetry"
NOTICE = (
    "Hypequery collects pseudonymous CLI usage to prioritise the roadmap.\n"
    "Never code, SQL, names, paths or credentials.\n"
    "Disable: hypequery telemetry disable, HYPEQUERY_TELEMETRY_DISABLED=1, or DO_NOT_TRACK=1.\n"
    f"Details: {TELEMETRY_DOCS_URL}\n\n"
)
_DURATIONS = (
    (0.1, "<100ms"),
    (1, "100ms-1s"),
    (10, "1s-10s"),
    (60, "10s-1m"),
    (600, "1m-10m"),
    (3600, "10m-1h"),
)
_current: ContextVar[CommandTelemetry | None] = ContextVar("hypequery_cli_telemetry", default=None)


def package_version() -> str:
    try:
        return version("hypequery")
    except PackageNotFoundError:
        return "unknown"


def duration_bucket(seconds: float) -> str:
    return next((bucket for limit, bucket in _DURATIONS if seconds < limit), "1h+")


def error_code(exc: BaseException) -> str:
    """Classified locally from the exception; its message is never sent."""

    names = {cls.__name__ for cls in type(exc).__mro__}
    if "DiscoveryConnectionError" in names:
        return "connection_failed"
    if isinstance(exc, ImportError) or "pip install" in str(exc):
        return "missing_dependency"
    if "CliError" in names:
        return "command_error"
    return "uncaught_exception"


class CommandTelemetry:
    def __init__(
        self,
        argv: Sequence[str],
        *,
        environ: Mapping[str, str] | None = None,
        flag_disabled: bool = False,
        cwd: Path | None = None,
    ) -> None:
        self._argv = list(argv)
        self._environ = os.environ if environ is None else environ
        self._flag_disabled = flag_disabled
        self._cwd = cwd
        self._started = time.monotonic()
        self._metrics: dict[str, Any] = {}
        self._cancelled = False
        self._common: dict[str, Any] | None = None
        self.command = requested_command(self._argv)

    def begin(self) -> None:
        """Resolve opt-outs first; only then create identity or inspect the project."""

        if self.command == "telemetry":
            return
        try:
            cli_version = package_version()
            state = resolve_state(
                self._environ, flag_disabled=self._flag_disabled, cli_version=cli_version
            )
            if not state.enabled or state.settings is None:
                return
            common = collect_environment(
                self._environ,
                cli_version=cli_version,
                is_tty=sys.stderr.isatty(),
                argv0=sys.argv[0] if sys.argv else "",
            )
            project = project_id(self._cwd or Path.cwd())
            self._common = {
                **common,
                "install_id": state.settings.install_id,
                "session_id": str(uuid.uuid4()),
                **({"project_id": project} if project else {}),
                "is_first_run": state.source == "default",
            }
            if common["is_tty"] and not common["is_ci"]:
                SettingsStore(self._environ).mark_notice_shown(_write_notice)
        except Exception:
            self._common = None

    def update(self, **metrics: Any) -> None:
        self._metrics.update({key: value for key, value in metrics.items() if value is not None})

    def cancel(self) -> None:
        self._cancelled = True

    def finish(self, outcome: str, error: str | None = None) -> None:
        common, self._common = self._common, None
        if common is None:
            return
        try:
            if self._cancelled and outcome == "success":
                outcome = "cancelled"
            if outcome == "failure" and self.command == "unknown":
                error = "unknown_command"
            if error == "usage_error" and has_unknown_option(self.command, self._argv):
                error = "unknown_option"
            properties: dict[str, Any] = {
                **common,
                **self._metrics,
                "command": self.command,
                "flags_used": flags_used(self.command, self._argv),
                "outcome": outcome,
                "duration_bucket": duration_bucket(time.monotonic() - self._started),
                **({"error_code": error} if error else {}),
            }
            if self.command == "help":
                properties["help_topic"] = help_topic(self._argv)
            if self.command == "unknown" and (suggestion := suggested_command(self._argv)):
                properties["suggested_command"] = suggestion
            if not validate_event(COMPLETED_EVENT, properties):
                self._debug("[telemetry] Dropped invalid event.")
                return
            event = wire_event(COMPLETED_EVENT, properties)
            if self._environ.get("HYPEQUERY_TELEMETRY_DEBUG") == "1":
                self._debug(json.dumps(event))
                return
            endpoint = telemetry_endpoint(
                self._environ.get("HYPEQUERY_TELEMETRY_URL") or DEFAULT_ENDPOINT
            )
            if endpoint:
                dispatch(endpoint, [event], config_directory(self._environ))
        except Exception:  # noqa: S110 - telemetry never affects the command
            pass

    def _debug(self, text: str) -> None:
        if self._environ.get("HYPEQUERY_TELEMETRY_DEBUG") == "1":
            print(text, file=sys.stderr)


def _write_notice() -> None:
    sys.stderr.write(NOTICE)
    sys.stderr.flush()


def activate(telemetry: CommandTelemetry) -> None:
    _current.set(telemetry)


def update_command_telemetry(**metrics: Any) -> None:
    """Called by commands for their variant fields; a no-op without telemetry."""

    telemetry = _current.get()
    if telemetry is not None:
        telemetry.update(**metrics)


def cancel_command_telemetry() -> None:
    telemetry = _current.get()
    if telemetry is not None:
        telemetry.cancel()
