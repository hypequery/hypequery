"""Whether this invocation may collect, and why; the first matching opt-out wins."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from .settings import SettingsStore, TelemetrySettings


@dataclass(frozen=True, slots=True)
class TelemetryState:
    enabled: bool
    source: str
    settings: TelemetrySettings | None


def opt_out_source(environ: Mapping[str, str], *, flag_disabled: bool) -> str | None:
    """Same order as the TypeScript CLI; customer CI is intentionally eligible."""

    if flag_disabled:
        return "flag"
    if environ.get("DO_NOT_TRACK") == "1":
        return "DO_NOT_TRACK"
    if environ.get("HYPEQUERY_TELEMETRY_DISABLED") == "1":
        return "HYPEQUERY_TELEMETRY_DISABLED"
    if environ.get("PYTEST_CURRENT_TEST"):
        return "test"
    if (
        environ.get("GITHUB_ACTIONS") == "true"
        and environ.get("GITHUB_REPOSITORY", "").lower() == "hypequery/hypequery"
    ):
        return "hypequery_ci"
    return None


def resolve_state(
    environ: Mapping[str, str], *, flag_disabled: bool, cli_version: str
) -> TelemetryState:
    store = SettingsStore(environ)
    source = opt_out_source(environ, flag_disabled=flag_disabled)
    if source:
        return TelemetryState(False, source, store.peek())
    existing = store.peek()
    settings = store.load()
    if settings is None:
        return TelemetryState(False, "config_unavailable", None)
    if cli_version in settings.disabled_versions:
        return TelemetryState(False, "kill_switch", settings)
    return TelemetryState(settings.enabled, "config" if existing else "default", settings)
