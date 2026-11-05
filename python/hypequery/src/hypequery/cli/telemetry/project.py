"""Pseudonymous project identity, hashed exactly as the TypeScript CLI hashes it.

The same git remote gives the same ``project_id`` from either CLI, so a project
using both runtimes counts once. Only bounded local file reads; never a shell.
"""

from __future__ import annotations

import hashlib
import re
import time
import tomllib
from pathlib import Path
from urllib.parse import urlsplit

#: HQ-233: shared across installs; the ingest proxy re-keys this digest.
PROJECT_HASH_SALT = "hypequery.cli.project.v1:"
_MAX_BYTES = 64 * 1024
_SCP = re.compile(r"^(?:[^/@\s]+@)?([^/:\s]+):(.+)$")
_STANDARD_PORTS = {"ssh": 22, "git": 9418, "https": 443, "http": 80}


def _read(file: Path) -> str | None:
    try:
        if not file.is_file() or file.stat().st_size > _MAX_BYTES:
            return None
        return file.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def normalize_remote(raw: str) -> str | None:
    raw = raw.strip()
    scp = (
        _SCP.match(raw)
        if "://" not in raw and re.match(r"^(?:[^/@\s]+@)?[^/:\s]+:[^\\\s]+$", raw)
        else None
    )
    if scp:
        if len(scp[1]) == 1:
            return None  # A Windows drive path, not a remote.
        raw = f"ssh://{scp[1]}/{scp[2]}"
    try:
        url = urlsplit(raw)
        port = url.port
    except ValueError:
        return None
    if url.scheme not in _STANDARD_PORTS or not url.hostname:
        return None
    repo = re.sub(r"\.git$", "", url.path.strip("/"), flags=re.I)
    if not repo:
        return None
    suffix = f":{port}" if port and port != _STANDARD_PORTS[url.scheme] else ""
    # Credentials, query, fragment and transport are excluded before hashing.
    return f"{url.hostname.lower()}{suffix}/{repo}"


def remote_from_git_config(config: str) -> str | None:
    in_remote = origin = False
    fallback = None
    for line in config.splitlines():
        section = re.match(r'^\[remote\s+"([^"]+)"\]$', line.strip())
        if section:
            in_remote, origin = True, section[1] == "origin"
            continue
        if line.strip().startswith("["):
            in_remote = False
            continue
        match = re.match(r"^\s*url\s*=\s*(.*?)\s*$", line, re.I) if in_remote else None
        if match:
            url = (
                match[1][1:-1] if match[1].startswith('"') and match[1].endswith('"') else match[1]
            )
            if origin:
                return url
            fallback = fallback or url
    return fallback


def _git_config(directory: Path) -> str | None:
    git = directory / ".git"
    pointer = _read(git)
    if pointer and (match := re.match(r"^gitdir:\s*(.+?)\s*$", pointer)):
        git = (directory / match[1]).resolve()
    common = _read(git / "commondir")
    if common:
        git = (git / common.strip()).resolve()
    return _read(git / "config")


def _pyproject_name(directory: Path) -> str | None:
    text = _read(directory / "pyproject.toml")
    try:
        name = tomllib.loads(text).get("project", {}).get("name") if text else None
    except tomllib.TOMLDecodeError:
        return None
    return name.strip() if isinstance(name, str) and name.strip() else None


def project_id(cwd: Path, budget_seconds: float = 0.005) -> str | None:
    """Hash of the git remote, else the nearest ``pyproject.toml`` name, else ``None``."""

    deadline = time.monotonic() + budget_seconds
    signal = name = None
    try:
        directory = cwd.resolve()
        for _ in range(24):
            if time.monotonic() >= deadline:
                break
            name = name or _pyproject_name(directory)
            config = _git_config(directory)
            if config is not None:
                remote = remote_from_git_config(config)
                normalized = normalize_remote(remote) if remote else None
                signal = f"remote:{normalized}" if normalized else None
                break
            if directory.parent == directory:
                break
            directory = directory.parent
    except OSError:
        return None
    signal = signal or (f"pyproject:{name}" if name else None)
    if signal is None:
        return None
    return hashlib.sha256(f"{PROJECT_HASH_SALT}{signal}".encode()).hexdigest()
