"""Install and runtime context common to every event. Never names, paths or values."""

from __future__ import annotations

import os
import platform
import re
import sys
from collections.abc import Mapping
from importlib.metadata import PackageNotFoundError, distribution
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from .catalog import EVENT_SCHEMA_VERSION, enum_values, matches_format

CI_SIGNALS = (
    ("GITHUB_ACTIONS", "github_actions"),
    ("GITLAB_CI", "gitlab"),
    ("CIRCLECI", "circleci"),
    ("BUILDKITE", "buildkite"),
    ("JENKINS_URL", "jenkins"),
    ("VERCEL", "vercel"),
    ("NETLIFY", "netlify"),
    ("TF_BUILD", "azure"),
    ("BITBUCKET_BUILD_NUMBER", "bitbucket"),
    ("TEAMCITY_VERSION", "teamcity"),
    ("TRAVIS", "travis"),
    ("CODEBUILD_BUILD_ID", "codebuild"),
)
_ARCH = {
    "arm64": "arm64",
    "aarch64": "arm64",
    "x86_64": "x64",
    "amd64": "x64",
    "i386": "ia32",
    "i686": "ia32",
    "x86": "ia32",
    "armv7l": "arm",
    "ppc64le": "ppc64",
    "s390x": "s390x",
    "riscv64": "riscv64",
}
INTEGRATIONS = enum_values("integrations")


def _set(environ: Mapping[str, str], key: str) -> bool:
    return environ.get(key, "") not in ("", "false", "0")


def ci_context(environ: Mapping[str, str]) -> dict[str, Any]:
    name = next((name for key, name in CI_SIGNALS if _set(environ, key)), None)
    ci = name is not None or _set(environ, "CI")
    return {"is_ci": ci, "ci_name": name or ("unknown" if ci else "none")}


def installer(dist_name: str = "hypequery") -> str:
    """The distribution's INSTALLER record (PEP 376), written by pip, uv, poetry, ..."""

    try:
        recorded = (distribution(dist_name).read_text("INSTALLER") or "").strip().lower()
    except (PackageNotFoundError, OSError):
        return "unknown"
    return recorded if recorded in enum_values("installer") else "unknown"


def install_environment(environ: Mapping[str, str]) -> str:
    if environ.get("CONDA_PREFIX") and Path(sys.prefix) == Path(environ["CONDA_PREFIX"]):
        return "conda"
    return "venv" if sys.prefix != sys.base_prefix else "system"


def invoked_via(argv0: str) -> str:
    prefix = sys.prefix.replace("\\", "/")
    if re.search(r"/uv/(?:archive-v\d+|builds-v\d+|environments-v\d+)/", prefix):
        return "uvx"
    if "/pipx/venvs/" in prefix or "/pipx/.cache/" in prefix:
        return "pipx"
    script = argv0.replace("\\", "/")
    if script.endswith("/__main__.py") or script == "-m":
        return "module"
    if script.rsplit("/", 1)[-1].removesuffix(".exe") == "hypequery":
        return "console_script"
    return "unknown"


def installed_integrations() -> list[str]:
    # find_spec on a top-level name locates it without importing it.
    found = []
    for name in INTEGRATIONS:
        try:
            if find_spec(name) is not None:
                found.append(name)
        except (ImportError, ValueError):
            continue
    return found


def _read(file: str) -> str:
    try:
        with open(file, encoding="utf-8") as handle:
            return handle.read(4096)
    except (OSError, UnicodeDecodeError):
        return ""


def collect_environment(
    environ: Mapping[str, str], *, cli_version: str, is_tty: bool, argv0: str
) -> dict[str, Any]:
    python = f"{sys.version_info.major}.{sys.version_info.minor}"
    os_name = sys.platform if sys.platform in enum_values("os") else "unknown"
    if sys.platform.startswith("freebsd"):
        os_name = "freebsd"
    return {
        "schema_version": EVENT_SCHEMA_VERSION,
        "cli_version": cli_version if matches_format("pep440_version", cli_version) else "unknown",
        "python_version": python if matches_format("major_minor", python) else "unknown",
        "os": os_name,
        "arch": _ARCH.get(platform.machine().lower(), "unknown"),
        **ci_context(environ),
        "is_tty": is_tty,
        "is_docker": os.path.exists("/.dockerenv")
        or re.search(r"docker|containerd|kubepods", _read("/proc/1/cgroup")) is not None,
        "is_wsl": bool(environ.get("WSL_DISTRO_NAME"))
        or "microsoft" in _read("/proc/sys/kernel/osrelease").lower(),
        "installer": installer(),
        "environment": install_environment(environ),
        "invoked_via": invoked_via(argv0),
        "integrations": installed_integrations(),
    }
