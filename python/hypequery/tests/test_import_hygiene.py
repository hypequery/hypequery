"""Import-hygiene guarantees for PYA-01.

These are acceptance criteria from the implementation plan, not stylistic
preferences:

* a minimal install must import without the FastAPI or driver extras;
* importing the package must perform no I/O — no sockets, no subprocesses;
* ``hypequery.serve`` must fail with an actionable message when its extra is
  absent, rather than a bare ``ModuleNotFoundError`` for ``fastapi``.

Each check runs in a subprocess because ``sys.modules`` in the test process is
already polluted by the test runner itself.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import textwrap


def run_python(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(source)],
        capture_output=True,
        text=True,
        check=False,
    )


def test_core_import_does_not_pull_optional_dependencies() -> None:
    result = run_python(
        """
        import sys

        import hypequery

        assert hypequery.__version__
        leaked = [m for m in ("fastapi", "starlette", "uvicorn", "clickhouse_connect")
                  if m in sys.modules]
        assert not leaked, f"optional dependencies leaked into a core import: {leaked}"
        """
    )
    assert result.returncode == 0, result.stderr


def test_import_performs_no_io() -> None:
    """No network or subprocess activity at import time.

    Deliberately does not watch ``exec``/``compile``: CPython raises those for
    every module it imports, so they carry no signal about our own behaviour.
    File reads are excluded for the same reason.
    """
    result = run_python(
        """
        import sys

        watched = {
            "socket.connect",
            "socket.getaddrinfo",
            "socket.gethostbyname",
            "subprocess.Popen",
            "os.system",
            "urllib.Request",
        }
        violations: list[str] = []
        importing = False

        def hook(event: str, args: object) -> None:
            if importing and event in watched:
                violations.append(event)

        sys.addaudithook(hook)

        importing = True
        import hypequery  # noqa: F401
        import hypequery.datasets  # noqa: F401
        import hypequery.protocol  # noqa: F401
        importing = False

        assert not violations, f"import-time I/O detected: {sorted(set(violations))}"
        """
    )
    assert result.returncode == 0, result.stderr


def test_serve_reports_missing_extra_actionably() -> None:
    fastapi_installed = importlib.util.find_spec("fastapi") is not None
    result = run_python("import hypequery.serve")

    if fastapi_installed:
        assert result.returncode == 0, result.stderr
        return

    assert result.returncode != 0
    assert "hypequery[fastapi]" in result.stderr, result.stderr
