"""Show or change the telemetry settings shared with the TypeScript CLI."""

from __future__ import annotations

import os

from ..errors import CliError
from ..options import TelemetryOptions
from ..telemetry.lifecycle import TELEMETRY_DOCS_URL, package_version
from ..telemetry.opt_out import resolve_state
from ..telemetry.settings import SettingsStore


def run(options: TelemetryOptions) -> None:
    if options.action != "status":
        settings = SettingsStore(os.environ).set_enabled(options.action == "enable")
        if settings is None:
            raise CliError(
                "Could not save telemetry settings. To disable for this run, set "
                "HYPEQUERY_TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1, or pass --no-telemetry."
            )
        print(f"Telemetry {'enabled' if settings.enabled else 'disabled'} in saved settings.")
    state = resolve_state(
        os.environ, flag_disabled=options.flag_disabled, cli_version=package_version()
    )
    print(f"Telemetry: {'enabled' if state.enabled else 'disabled'} (source: {state.source})")
    print(f"Install ID: {state.settings.install_id if state.settings else 'unavailable'}")
    print(f"Learn more: {TELEMETRY_DOCS_URL}")
