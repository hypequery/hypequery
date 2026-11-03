"""Cross-process lock for the settings file, interoperable with the TypeScript CLI.

Both CLIs share ``telemetry.json``, so they share its lock protocol: the lock is
a ``telemetry.lock`` directory holding exactly one ``owner.<pid>.<host>.<uuid>``
file, published by an atomic rename. A writer only ever removes its own owner
file, and takes over a lock only when its owner is a dead process on this host.
See ``packages/cli/src/utils/telemetry/settings-lock.ts`` for the full rationale.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import re
import shutil
import socket
import sys
import time
import uuid
from pathlib import Path

ORPHANED_LOCK_SECONDS = 10.0
_OWNER = re.compile(r"^owner\.(\d+)\.([0-9a-f]{12})\.([0-9a-f-]{36})$")


def _host_hash() -> str:
    return hashlib.sha256(socket.gethostname().encode()).hexdigest()[:12]


def _process_is_alive(pid: int) -> bool:
    if sys.platform == "win32":
        # os.kill(pid, 0) sends CTRL_C_EVENT on Windows; assume alive (fail closed).
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True  # EPERM: it exists but belongs to another user.
    return True


class SettingsLock:
    def __init__(self, lock_path: Path, owner: str) -> None:
        self._path = lock_path
        self._owner = owner

    def release(self) -> None:
        try:
            (self._path / self._owner).unlink()
        except OSError:
            return  # Not ours any more: never remove someone else's lock.
        with contextlib.suppress(OSError):
            self._path.rmdir()  # Only while empty; a lock published meanwhile survives.


def _take_over(lock_path: Path, owner: str) -> bool:
    try:
        owners = [entry.name for entry in lock_path.iterdir() if entry.name.startswith("owner.")]
    except OSError:
        return False
    if not owners:
        try:
            if time.time() - lock_path.stat().st_mtime >= ORPHANED_LOCK_SECONDS:
                lock_path.rmdir()
        except OSError:
            pass
        return False
    match = _OWNER.match(owners[0]) if len(owners) == 1 else None
    if match is None or match[2] != _host_hash() or _process_is_alive(int(match[1])):
        return False
    try:
        (lock_path / owners[0]).rename(lock_path / owner)
    except OSError:
        return False
    return True


def acquire_settings_lock(directory: Path, attempts: int) -> SettingsLock | None:
    lock_path = directory / "telemetry.lock"
    owner = f"owner.{os.getpid()}.{_host_hash()}.{uuid.uuid4()}"
    staged = directory / f"telemetry.lock.{uuid.uuid4()}.tmp"
    staged.mkdir(mode=0o700)
    try:
        (staged / owner).touch(mode=0o600, exist_ok=False)
        for attempt in range(attempts):
            try:
                staged.rename(lock_path)
                return SettingsLock(lock_path, owner)
            except OSError:
                pass
            if _take_over(lock_path, owner):
                return SettingsLock(lock_path, owner)
            if attempt + 1 < attempts:
                time.sleep(0.01)
        return None
    finally:
        shutil.rmtree(staged, ignore_errors=True)
