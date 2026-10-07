"""Isolated artifact installation and real CLI onboarding checks."""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import cast

from getting_started import BUDGET_SECONDS, clickhouse

from .checks import require


class InstalledCli:
    def __init__(self, root: Path, artifact: Path, *, minimal: bool) -> None:
        self.root = root
        self.artifact = artifact
        self.minimal = minimal
        self.venv = root / "venv"
        self.python = self.venv / "bin" / "python"
        self.cli = self.venv / "bin" / "hypequery"
        self.project = root / "my analytics"
        self.env = dict(os.environ)
        for key in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"):
            self.env.pop(key, None)
        # The journey cannot accidentally find Node tools on the user's PATH.
        self.env["PATH"] = f"{self.python.parent}{os.pathsep}{os.defpath}"
        self.env["PYTHONNOUSERSITE"] = "1"

    def _run(self, args: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(  # noqa: S603
            args,
            cwd=cwd or self.root,
            env=self.env,
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Command failed ({args[0]}):\n{result.stdout}\n{result.stderr}")
        return result

    def install(self) -> None:
        uv = shutil.which("uv")
        if uv is None:
            raise RuntimeError("uv is required to verify artifacts")
        self._run([uv, "venv", "--python", sys.executable, str(self.venv)])
        requirement = str(self.artifact)
        if not self.minimal:
            requirement += "[fastapi,clickhouse]"
        self._run([uv, "pip", "install", "--python", str(self.python), requirement])

    def verify_commands(self) -> None:
        metadata = self._run(
            [
                str(self.python),
                "-c",
                """
import json
import sys
from pathlib import Path
from typing import cast
from importlib.metadata import version
import hypequery
assert Path(hypequery.__file__).resolve().is_relative_to(Path(sys.prefix).resolve())
print(json.dumps({'version': version('hypequery')}))
""",
            ]
        )
        version = json.loads(metadata.stdout)["version"]
        for entry in ([str(self.cli)], [str(self.python), "-m", "hypequery"]):
            require(
                self._run([*entry, "--version"]).stdout.strip() == f"hypequery {version}",
                "CLI version differs from installed metadata",
            )
            for args in (
                ["--help"],
                ["init", "--help"],
                ["dev", "--help"],
                ["generate", "datasets", "--help"],
                ["help", "generate"],
                ["help"],
                ["help", "init"],
                ["help", "dev"],
            ):
                require(
                    "usage: hypequery" in self._run([*entry, *args]).stdout, "CLI help is missing"
                )
        self._run([str(self.cli), "init", "--skip-connection", "--path", str(self.project)])
        self._run(
            [
                str(self.python),
                "-c",
                """
import ast
import tomllib
from pathlib import Path
from typing import cast
ast.parse(Path('app.py').read_text())
tomllib.loads(Path('pyproject.toml').read_text())
assert Path('.env.example').is_file()
assert Path('.gitignore').is_file()
assert 'not loaded automatically' in Path('README.md').read_text()
""",
            ],
            cwd=self.project,
        )
        if self.minimal:
            self._run(
                [
                    str(self.python),
                    "-c",
                    """
from importlib.util import find_spec
optional = ('fastapi', 'starlette', 'uvicorn', 'clickhouse_connect')
assert all(find_spec(name) is None for name in optional)
""",
                ]
            )
            result = subprocess.run(  # noqa: S603
                [str(self.cli), "dev"],
                cwd=self.project,
                env=self.env,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            require(result.returncode == 1, "Missing extras must exit with status 1")
            require(
                'pip install "hypequery[fastapi]"' in result.stderr,
                "Missing extras need an install hint",
            )
            require("Traceback" not in result.stderr, "Missing extras must not print a traceback")

    def serve_and_query(self) -> None:
        database = f"hypequery_cli_{secrets.token_hex(6)}"
        self.env["CLICKHOUSE_DATABASE"] = database
        self.env["HYPEQUERY_DEV_TOKEN"] = secrets.token_urlsafe(32)
        try:
            clickhouse(f"CREATE DATABASE {database}")
            for statement in (self.project / "seed.sql").read_text().split(";"):
                if statement.strip():
                    clickhouse(statement, database=database)
            self._serve()
            self.project = self.root / "discovered analytics"
            self._run([str(self.cli), "init", "--path", str(self.project), "--tables", "orders"])
            require(
                (self.project / "datasets.py").is_file(), "Live discovery did not generate datasets"
            )
            require(
                not (self.project / "seed.sql").exists(), "Live discovery must not create a seed"
            )
            snapshot = json.loads((self.project / "schema.json").read_text())
            require(snapshot["database"] == database, "Discovery bound the wrong database")
            require(snapshot["tables"][0]["table"] == "orders", "Wrong table selection")
            self._serve(schema_expected=self._schema_ground_truth())
            args = [
                str(self.cli),
                "generate",
                "datasets",
                "--output",
                str(self.project / "datasets.py"),
                "--tables",
                "orders",
            ]
            self._run([*args, "--check"])
            original = (self.project / "datasets.py").read_bytes()
            clickhouse(f"ALTER TABLE {database}.orders ADD COLUMN regeneration_probe String")
            for flag in ("--check", "--diff"):
                result = subprocess.run(  # noqa: S603
                    [*args, flag],
                    cwd=self.project,
                    env=self.env,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )
                require(result.returncode == 1, "Schema drift must return status 1")
                require(
                    (self.project / "datasets.py").read_bytes() == original,
                    "Read-only regeneration changed definitions",
                )
                if flag == "--diff":
                    require("regenerationProbe" in result.stdout, "Diff missed added column")
            self._run([*args, "--force"])
            self._run([*args, "--check"])
            clickhouse(
                "INSERT INTO orders "
                "(id, country, status, amount, created_at, regeneration_probe) "
                "VALUES ('regenerated', 'NZ', 'paid', 12, now(), 'new-column-value')",
                database=database,
            )
            self._serve(
                schema_expected=self._schema_ground_truth(regenerated=True),
                schema_query={
                    "dimensions": ["regenerationProbe"],
                    "measures": ["totalCount"],
                    "orderBy": [{"field": "regenerationProbe", "direction": "asc"}],
                },
            )
        finally:
            clickhouse(f"DROP DATABASE IF EXISTS {database}")

    def _schema_ground_truth(self, *, regenerated: bool = False) -> dict[str, object]:
        result = self._run(
            [
                str(self.python),
                "-c",
                """
import json, os, sys
import clickhouse_connect
client = clickhouse_connect.get_client(
    host=os.environ.get('CLICKHOUSE_HOST', 'localhost'),
    port=int(os.environ.get('CLICKHOUSE_PORT', '8123')),
    database=os.environ['CLICKHOUSE_DATABASE'],
    username=os.environ.get('CLICKHOUSE_USERNAME', 'default'),
    password=os.environ.get('CLICKHOUSE_PASSWORD', ''),
)
try:
    regenerated = sys.argv[1] == 'True'
    query = (
        'SELECT regeneration_probe, toString(count()) FROM orders '
        'GROUP BY regeneration_probe ORDER BY regeneration_probe'
        if regenerated else
        'SELECT id, toString(count()) FROM orders GROUP BY id ORDER BY id'
    )
    result = client.query(query)
    rows = result.result_rows
    field = 'regenerationProbe' if regenerated else 'id'
    print(json.dumps({'data': [{field: row[0], 'totalCount': row[1]} for row in rows]}))
finally:
    client.close()
""",
                str(regenerated),
            ]
        )
        return cast(dict[str, object], json.loads(result.stdout))

    def _serve(
        self,
        *,
        schema_expected: dict[str, object] | None = None,
        schema_query: dict[str, object] | None = None,
    ) -> None:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        with (self.root / "server.log").open("w+") as log:
            process = subprocess.Popen(  # noqa: S603
                [str(self.cli), "dev", "--port", str(port)],
                cwd=self.project,
                env=self.env,
                stdout=log,
                stderr=log,
                text=True,
                start_new_session=True,
            )
            try:
                self._wait(process, base)
                readme = (self.project / "README.md").read_text()
                query_match = re.search(r"-d '([^']+)'", readme)
                expected_match = re.search(r"```json\n(.*?)```", readme, re.S)
                if query_match is None or (schema_expected is None and expected_match is None):
                    raise RuntimeError(
                        "Generated README must contain the tested query and response"
                    )
                query = json.loads(query_match[1])
                if schema_query is not None:
                    query = schema_query
                elif schema_expected is not None:
                    query["orderBy"] = [{"field": "id", "direction": "asc"}]
                expected = schema_expected or json.loads(
                    expected_match[1] if expected_match else "{}"
                )
                request = urllib.request.Request(  # noqa: S310 - URL is fixed to loopback HTTP
                    f"{base}/datasets/orders/query",
                    data=json.dumps(query).encode(),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self.env['HYPEQUERY_DEV_TOKEN']}",
                    },
                )
                with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
                    require(
                        json.load(response) == expected,
                        "Query response differs from generated README",
                    )
                del request.headers["Authorization"]
                try:
                    urllib.request.urlopen(request, timeout=10).close()  # noqa: S310
                except urllib.error.HTTPError as exc:
                    require(exc.code == 401, "Unauthenticated query must return 401")
                else:
                    raise RuntimeError("Unauthenticated request was accepted")
            except BaseException:
                log.seek(0)
                print(log.read(), file=sys.stderr)
                raise
            finally:
                self._stop(process)
        with socket.socket() as probe:
            require(probe.connect_ex(("127.0.0.1", port)) != 0, "Server child survived cleanup")

    def _wait(self, process: subprocess.Popen[str], base: str) -> None:
        until = time.monotonic() + 60
        while time.monotonic() < until:
            if process.poll() is not None:
                raise RuntimeError("CLI server exited during startup")
            try:
                with urllib.request.urlopen(f"{base}/docs", timeout=1) as response:  # noqa: S310
                    if response.status == 200:
                        return
            except (urllib.error.URLError, ConnectionError):
                time.sleep(0.1)
        raise RuntimeError("CLI server did not become ready within 60 seconds")

    def _stop(self, process: subprocess.Popen[str]) -> None:
        try:
            os.killpg(process.pid, signal.SIGINT)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)


def verify_artifact(artifact: Path, *, minimal: bool) -> None:
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="hypequery-cli-") as scratch:
        journey = InstalledCli(Path(scratch).resolve(), artifact, minimal=minimal)
        journey.install()
        journey.verify_commands()
        if not minimal:
            journey.serve_and_query()
    elapsed = time.monotonic() - started
    print(f"Installed {'base' if minimal else 'onboarding'} CLI checks passed in {elapsed:.1f}s")
    if elapsed > BUDGET_SECONDS:
        raise RuntimeError("Installed CLI onboarding exceeded the 15-minute budget")
