"""Run the README's Getting started walkthrough end to end (PYE-01).

The steps are the README's own code blocks, found by their
``<!-- getting-started: name -->`` markers, so the documented path cannot drift
from the one that works. The script:

1. installs a built wheel with the ``fastapi`` and ``clickhouse`` extras into a
   fresh virtual environment;
2. runs the seed SQL in a scratch database;
3. writes ``app.py`` and starts it with the README's run command;
4. runs the README's curl request and compares it with the README's response;
5. fails if the whole path takes longer than the 15-minute budget.

ClickHouse comes from ``CLICKHOUSE_HOST``, ``CLICKHOUSE_PORT``,
``CLICKHOUSE_USERNAME`` and ``CLICKHOUSE_PASSWORD``. The server must run on
this machine: the walkthrough speaks plain HTTP, so it refuses to send
credentials anywhere else, and never follows redirects. The scratch database
gets a fresh random name, so no existing database is touched. Usage::

    uv build --wheel
    uv run python scripts/getting_started.py dist/hypequery-*.whl
"""

from __future__ import annotations

import argparse
import base64
import ipaddress
import json
import os
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

README = Path(__file__).resolve().parent.parent / "README.md"
BUDGET_SECONDS = 15 * 60
SERVER = "http://127.0.0.1:8000"
_BLOCK = re.compile(r"<!-- getting-started: (?P<name>[\w.]+) -->\n```\w*\n(?P<body>.*?)```", re.S)


def readme_blocks() -> dict[str, str]:
    blocks = {match["name"]: match["body"] for match in _BLOCK.finditer(README.read_text())}
    missing = {"seed.sql", "app.py", "run", "query", "response"} - blocks.keys()
    if missing:
        raise SystemExit(f"README is missing getting-started blocks: {sorted(missing)}")
    return blocks


def is_local(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect would carry the Authorization header to wherever it points."""

    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def clickhouse(sql: str, *, database: str = "default") -> None:
    host = os.environ.get("CLICKHOUSE_HOST", "localhost")
    port = os.environ.get("CLICKHOUSE_PORT", "8123")
    user = os.environ.get("CLICKHOUSE_USERNAME", "default")
    password = os.environ.get("CLICKHOUSE_PASSWORD", "")
    if not is_local(host):
        raise SystemExit(
            f"the walkthrough uses plain HTTP, so it only talks to a ClickHouse server on "
            f"this machine, not {host}"
        )
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    request = urllib.request.Request(
        f"http://{host}:{port}/?database={database}",
        data=sql.encode(),
        headers={"Authorization": f"Basic {token}"},
    )
    with _OPENER.open(request, timeout=30) as response:
        response.read()


def install(wheel: Path, venv: Path) -> Path:
    uv = shutil.which("uv")
    if uv is None:
        raise SystemExit("uv is required to create the walkthrough environment")
    version = f"{sys.version_info.major}.{sys.version_info.minor}"
    subprocess.run([uv, "venv", "--python", version, str(venv)], check=True)  # noqa: S603
    python = venv / "bin" / "python"
    subprocess.run(  # noqa: S603
        [uv, "pip", "install", "--python", str(python), f"{wheel}[fastapi,clickhouse]"],
        check=True,
    )
    return python


def run_command(block: str) -> str:
    """The one line of the run block that starts the server."""

    lines = [line for line in block.splitlines() if "hypequery.serve.dev" in line]
    if len(lines) != 1 or not lines[0].startswith("python -m hypequery.serve.dev app:app"):
        raise SystemExit("README run block must start the server with the dev runner")
    return lines[0]


def wait_for_server(process: subprocess.Popen[bytes]) -> None:
    until = time.monotonic() + 60
    while True:
        try:
            urllib.request.urlopen(f"{SERVER}/docs", timeout=1).read()  # noqa: S310
            return
        except (urllib.error.URLError, ConnectionError):
            if process.poll() is not None or time.monotonic() > until:
                raise SystemExit("the development server did not start") from None
            time.sleep(0.2)


def unauthenticated_status() -> int:
    request = urllib.request.Request(  # noqa: S310 - fixed http scheme
        f"{SERVER}/datasets/orders/query",
        data=b"{}",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            return int(response.status)
    except urllib.error.HTTPError as error:
        return error.code


def walkthrough(wheel: Path) -> None:
    started = time.monotonic()
    blocks = readme_blocks()
    with tempfile.TemporaryDirectory(prefix="hypequery-getting-started-") as scratch:
        workdir = Path(scratch)
        python = install(wheel, workdir / ".venv")

        # A fresh name, created without IF NOT EXISTS: the walkthrough only
        # ever drops the database it created itself.
        database = f"hypequery_getting_started_{secrets.token_hex(6)}"
        try:
            # Inside the try: a lost response to CREATE still gets cleaned up.
            clickhouse(f"CREATE DATABASE {database}")
            serve_walkthrough(blocks, workdir, python, database)
        finally:
            clickhouse(f"DROP DATABASE IF EXISTS {database}")

    elapsed = time.monotonic() - started
    print(f"getting started walkthrough passed in {elapsed:.1f}s")
    if elapsed > BUDGET_SECONDS:
        raise SystemExit(f"walkthrough took {elapsed:.0f}s, over the {BUDGET_SECONDS}s budget")


def serve_walkthrough(blocks: dict[str, str], workdir: Path, python: Path, database: str) -> None:
    for statement in blocks["seed.sql"].split(";"):
        if statement.strip():
            clickhouse(statement, database=database)

    (workdir / "app.py").write_text(blocks["app.py"])
    env = {
        **os.environ,
        "PATH": f"{python.parent}{os.pathsep}{os.environ['PATH']}",
        "HYPEQUERY_DEV_TOKEN": "dev-secret",
        "CLICKHOUSE_DATABASE": database,
    }
    env.pop("VIRTUAL_ENV", None)
    server = subprocess.Popen(  # noqa: S603
        ["bash", "-c", run_command(blocks["run"])],  # noqa: S607
        cwd=workdir,
        env=env,
        start_new_session=True,
    )
    try:
        wait_for_server(server)
        query = subprocess.run(  # noqa: S603
            ["bash", "-c", blocks["query"]],  # noqa: S607
            cwd=workdir,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        actual = json.loads(query.stdout)
        expected = json.loads(blocks["response"])
        if actual != expected:
            raise SystemExit(f"response differs from README:\n{query.stdout}")
        status = unauthenticated_status()
        if status != 401:
            raise SystemExit(f"a request without the token returned {status}, not 401")
    finally:
        os.killpg(server.pid, signal.SIGTERM)
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(server.pid, signal.SIGKILL)
            server.wait()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("wheel", type=Path, help="built hypequery wheel")
    wheel = parser.parse_args().wheel.resolve()
    if not wheel.is_file():
        raise SystemExit(f"no wheel at {shlex.quote(str(wheel))}")
    walkthrough(wheel)


if __name__ == "__main__":
    main()
