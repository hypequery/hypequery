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

import pytest


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
        leaked = [m for m in ("fastapi", "starlette", "uvicorn", "clickhouse_connect",
                              "jwt", "cryptography")
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
        import hypequery.execution  # noqa: F401
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


def test_serve_imports_without_the_jwt_extra_and_jwt_helpers_ask_for_it() -> None:
    if importlib.util.find_spec("fastapi") is None:
        pytest.skip("hypequery.serve needs the fastapi extra")
    result = run_python(
        """
        import sys

        sys.modules["jwt"] = None
        import hypequery.serve
        import hypequery.serve.core.jwt_auth
        from hypequery.serve import analytics_token_issuer, jwt_strategy

        assert "cryptography" not in sys.modules
        for make in (
            lambda: jwt_strategy(secret="x" * 32),
            lambda: analytics_token_issuer("x" * 32),
        ):
            try:
                make()
            except ModuleNotFoundError as exc:
                assert 'pip install "hypequery[jwt]"' in str(exc), exc
            else:
                raise AssertionError("JWT helpers must ask for the jwt extra")
        """
    )
    assert result.returncode == 0, result.stderr


def test_definition_imports_leave_dataframe_libraries_and_frameworks_alone() -> None:
    result = run_python(
        """
        import sys

        import hypequery.datasets
        import hypequery.execution
        import hypequery.contrib.sqlalchemy

        optional = ("pandas", "polars", "pyarrow", "django", "flask", "sqlalchemy")
        leaked = [m for m in optional if m in sys.modules]
        assert not leaked, f"optional libraries leaked into a definition import: {leaked}"
        assert "hypequery.contrib.django" not in sys.modules
        """
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(("module", "extra"), [("django", "django"), ("flask", "flask")])
def test_contrib_reports_missing_framework_actionably(module: str, extra: str) -> None:
    result = run_python(
        f"""
        import sys

        sys.modules[{module!r}] = None
        import hypequery.contrib.{module}
        """
    )
    assert result.returncode != 0
    assert f"hypequery[{extra}]" in result.stderr, result.stderr


def test_version_matches_the_package_metadata() -> None:
    import tomllib
    from importlib.metadata import version
    from pathlib import Path

    import hypequery

    project = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())
    assert hypequery.__version__ == version("hypequery") == project["project"]["version"]
