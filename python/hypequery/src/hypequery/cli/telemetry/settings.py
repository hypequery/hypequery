"""Telemetry settings shared with the TypeScript CLI (``telemetry.json``).

One file per machine means one install ID, one disclosure notice and one opt-out
across both CLIs. Keys this module does not own are preserved on every write.
The TypeScript CLI rejects a kill-switch list containing PEP 440 versions, so
this CLI keeps its own under ``disabled_python_cli_versions``.
"""

from __future__ import annotations

import json
import os
import re
import sys
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .catalog import matches_format
from .settings_lock import acquire_settings_lock

SCHEMA_VERSION = 1
PYTHON_KILL_SWITCH = "disabled_python_cli_versions"
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


@dataclass(frozen=True, slots=True)
class TelemetrySettings:
    enabled: bool
    install_id: str
    notice_shown_at: str | None
    disabled_versions: tuple[str, ...]
    #: The file as read, so writes keep keys owned by the TypeScript CLI.
    raw: Mapping[str, Any]


def config_directory(environ: Mapping[str, str], platform: str = sys.platform) -> Path | None:
    """The TypeScript CLI's ``configDirectory``, resolved the same way."""

    explicit = environ.get("HYPEQUERY_CONFIG_DIR")
    if explicit:
        return Path(explicit)
    if platform == "win32":
        base = environ.get("APPDATA") or environ.get("LOCALAPPDATA") or environ.get("USERPROFILE")
        return Path(base, "hypequery") if base else None
    if platform != "darwin" and environ.get("XDG_CONFIG_HOME"):
        return Path(environ["XDG_CONFIG_HOME"], "hypequery")
    home = environ.get("HOME")
    if not home or not Path(home).is_dir():
        return None
    if platform == "darwin":
        return Path(home, "Library", "Application Support", "hypequery")
    return Path(home, ".config", "hypequery")


def parse_settings(text: str) -> TelemetrySettings | None:
    """Reject malformed or future settings rather than silently enabling telemetry."""

    try:
        value = json.loads(text)
    except ValueError:
        return None
    if not isinstance(value, dict) or value.get("schema_version") != SCHEMA_VERSION:
        return None
    enabled, install_id = value.get("enabled"), value.get("install_id")
    notice, disabled = value.get("notice_shown_at"), value.get(PYTHON_KILL_SWITCH, [])
    if (
        not isinstance(enabled, bool)
        or not isinstance(install_id, str)
        or not _UUID.match(install_id)
    ):
        return None
    if notice is not None and not isinstance(notice, str):
        return None
    if not isinstance(disabled, list) or not all(
        matches_format("pep440_version", item) for item in disabled
    ):
        return None
    return TelemetrySettings(enabled, install_id, notice, tuple(disabled), value)


class SettingsStore:
    def __init__(self, environ: Mapping[str, str] | None = None) -> None:
        self._directory = config_directory(os.environ if environ is None else environ)

    def peek(self) -> TelemetrySettings | None:
        """Inspect without creating an identity or changing a disabled installation."""

        try:
            if self._directory is None:
                return None
            return parse_settings((self._directory / "telemetry.json").read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            return None

    def load(self) -> TelemetrySettings | None:
        """Read, or create on first use; every failure fails closed."""

        return self._update(None, None)

    def set_enabled(self, enabled: bool) -> TelemetrySettings | None:
        return self._update(enabled, None)

    def mark_notice_shown(self, write: Callable[[], None]) -> None:
        def show(raw: dict[str, Any]) -> dict[str, Any]:
            if not raw["enabled"] or raw.get("notice_shown_at"):
                return raw
            write()
            stamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            return {**raw, "notice_shown_at": stamp}

        self._update(None, show)

    def disable_version(self, version: str) -> None:
        """Kill switch from an HTTP 410; amends only settings that already exist."""

        if not matches_format("pep440_version", version):
            return

        def disable(raw: dict[str, Any]) -> dict[str, Any]:
            versions = [*dict.fromkeys([*raw.get(PYTHON_KILL_SWITCH, []), version])][-20:]
            return {**raw, PYTHON_KILL_SWITCH: versions}

        self._update(None, disable, attempts=1, require_existing=True)

    def _update(
        self,
        enabled: bool | None,
        mutate: Callable[[dict[str, Any]], dict[str, Any]] | None,
        attempts: int = 20,
        require_existing: bool = False,
    ) -> TelemetrySettings | None:
        lock = None
        try:
            if self._directory is None:
                return None
            self._directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            lock = acquire_settings_lock(self._directory, attempts)
            if lock is None:
                return None
            return self._write_locked(
                self._directory / "telemetry.json", enabled, mutate, require_existing
            )
        except OSError:
            return None
        finally:
            if lock is not None:
                lock.release()

    @staticmethod
    def _write_locked(
        file: Path,
        enabled: bool | None,
        mutate: Callable[[dict[str, Any]], dict[str, Any]] | None,
        require_existing: bool,
    ) -> TelemetrySettings | None:
        try:
            previous = parse_settings(file.read_text(encoding="utf-8"))
            # Explicit enable/disable can repair settings; ordinary commands cannot.
            if previous is None and enabled is None:
                return None
        except FileNotFoundError:
            previous = None
        if previous is None and require_existing:
            return None
        raw: dict[str, Any] = dict(previous.raw) if previous else {}
        raw.setdefault("schema_version", SCHEMA_VERSION)
        raw.setdefault("install_id", str(uuid.uuid4()))
        raw.setdefault("enabled", True)
        if enabled is not None:
            raw["enabled"] = enabled
        updated = mutate(raw) if mutate else raw
        if previous is not None and updated == previous.raw:
            return previous
        temporary = file.with_name(f"{file.name}.{uuid.uuid4()}.tmp")
        try:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(json.dumps(updated, indent=2) + "\n")
            os.replace(temporary, file)
        finally:
            temporary.unlink(missing_ok=True)
        return parse_settings(json.dumps(updated))
