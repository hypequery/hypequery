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

#: Each `init --framework` choice besides standalone, and the app files it writes.
FRAMEWORK_FILES = {
    "django": ("analytics.py", "urls.py", "settings.py", "manage.py"),
    "flask": ("app.py",),
}


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
        self.env["PATH"] = str(self.python.parent)
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
            requirement += "[server,clickhouse,django,flask]"
        self._run([uv, "pip", "install", "--python", str(self.python), requirement])

    def verify_commands(self) -> None:
        metadata = self._run(
            [
                str(self.python),
                "-c",
                """
import json
import shutil
import sys
from pathlib import Path
from importlib.metadata import version
import hypequery
assert all(shutil.which(tool) is None for tool in ('node', 'npm', 'npx', 'pnpm', 'yarn'))
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
                ["generate:datasets", "--help"],
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
ast.parse(Path('app.py').read_text())
tomllib.loads(Path('pyproject.toml').read_text())
assert Path('.env.example').is_file()
assert Path('.gitignore').is_file()
assert 'not loaded automatically' in Path('README.md').read_text()
""",
            ],
            cwd=self.project,
        )
        for framework, files in FRAMEWORK_FILES.items():
            project = self.root / f"{framework} example"
            self._run(
                [str(self.cli), "init", "--skip-connection", "--framework", framework, str(project)]
            )
            for name in (*files, "datasets.py"):
                compile((project / name).read_text(), name, "exec")
        if self.minimal:
            self._run(
                [
                    str(self.python),
                    "-c",
                    """
from importlib.util import find_spec
optional = ('fastapi', 'starlette', 'uvicorn', 'clickhouse_connect')
assert all(find_spec(name) is None for name in optional)
# Serving needs no web framework: only running uvicorn needs an extra.
import hypequery.serve
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
                'pip install "hypequery[server]"' in result.stderr,
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
            for framework in FRAMEWORK_FILES:
                self._serve_framework(framework)
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
            self._nullable_count_journey(database)
        finally:
            clickhouse(f"DROP DATABASE IF EXISTS {database}")

    def _nullable_count_journey(self, database: str) -> None:
        clickhouse(f"CREATE TABLE {database}.nullable_events (value Nullable(Int64)) ENGINE=Memory")
        clickhouse("INSERT INTO nullable_events VALUES (NULL), (7), (NULL)", database=database)
        self.project = self.root / "nullable analytics"
        result = self._run(
            [str(self.cli), "init", "--path", str(self.project), "--tables", "nullable_events"]
        )
        require(
            "not every row" in result.stdout + result.stderr, "Nullable count warning is missing"
        )
        self._run(
            [str(self.cli), "generate", "datasets", "--tables", "nullable_events", "--check"],
            cwd=self.project,
        )
        expected = self._run(
            [
                str(self.python),
                "-c",
                """
import json
import clickhouse_connect
from pathlib import Path
from datasets import datasets
from hypequery.datasets import (
    DatasetQuery, create_dataset_client, create_dataset_registry, write_dataset_bundle,
)
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

connection = ClickHouseConnection.from_env()
with clickhouse_connect.get_client(
    host=connection.host, port=connection.port, database=connection.database,
    username=connection.username, password=connection.password,
) as raw:
    row_count, non_null_count = raw.query(
        'SELECT count(), count(value) FROM nullable_events'
    ).result_rows[0]
assert row_count == 3 and non_null_count == 1
definition = datasets['nullable_events']
assert 'totalCount' not in definition.measures
registry = create_dataset_registry(definition)
write_dataset_bundle('bundle', registry)
deployment = json.loads(Path('bundle/deployment.json').read_text())
count = next(m for m in deployment['datasets'][0]['measures'] if m['name'] == 'nonNullCount')
assert count['aggregation'] == 'count' and count['field'] == 'value'
with create_clickhouse_executor(connection) as executor:
    client = create_dataset_client(executor=executor, registry=registry)
    result = client.execute(definition, DatasetQuery(measures=('nonNullCount',)))
assert result.data == ({'nonNullCount': non_null_count},)
print(json.dumps({'data': [{'nonNullCount': str(non_null_count)}]}))
""",
            ],
            cwd=self.project,
        )
        self._serve(
            schema_expected=cast(dict[str, object], json.loads(expected.stdout)),
            schema_query={"measures": ["nonNullCount"]},
            schema_path="/datasets/nullable_events/query",
        )

    def _serve_framework(self, framework: str) -> None:
        """Run the framework's offline example under its own server and query it."""

        self.project = self.root / f"{framework} example"
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = str(probe.getsockname()[1])
        if framework == "django":
            self._run([str(self.python), "manage.py", "migrate", "-v", "0"], cwd=self.project)
            command = [str(self.python), "manage.py", "runserver", port, "--noreload"]
        else:
            command = [str(self.python), "-m", "flask", "--app", "app", "run", "--port", port]
        self._serve(command=command, port=int(port), query_path="/api/agents/orders")

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
        schema_path: str = "/datasets/orders/query",
        command: list[str] | None = None,
        port: int | None = None,
        query_path: str | None = None,
    ) -> None:
        """Start the project's server and check the README's query against it.

        By default the server is `hypequery dev`; a framework scaffold passes
        its own *command*, listening on *port*, and the *query_path* it serves.
        """

        if port is None:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        with (self.root / "server.log").open("w+") as log:
            process = subprocess.Popen(  # noqa: S603
                command or [str(self.cli), "dev", "--port", str(port)],
                cwd=self.project,
                env=self.env,
                stdout=log,
                stderr=log,
                text=True,
                start_new_session=True,
            )
            try:
                self._wait(process, base, "/docs" if command is None else query_path or "/")
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
                    f"{base}{query_path or schema_path}",
                    data=json.dumps(query).encode(),
                    headers={"Content-Type": "application/json"},
                )
                # The standalone API is open for local development; a framework
                # scaffold's agents API takes the development token.
                if command is not None:
                    request.add_header("Authorization", f"Bearer {self.env['HYPEQUERY_DEV_TOKEN']}")
                with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
                    require(
                        json.load(response) == expected,
                        "Query response differs from generated README",
                    )
                if command is not None:
                    del request.headers["Authorization"]
                    try:
                        urllib.request.urlopen(request, timeout=10).close()  # noqa: S310
                    except urllib.error.HTTPError as exc:
                        require(exc.code == 401, "Unauthenticated query must return 401")
                    else:
                        raise RuntimeError("Unauthenticated request was accepted")
            finally:
                try:
                    self._stop(process)
                    with socket.socket() as probe:
                        require(
                            probe.connect_ex(("127.0.0.1", port)) != 0,
                            "Server child survived cleanup",
                        )
                finally:
                    # Retain shutdown diagnostics before temporary files disappear.
                    if sys.exc_info()[0] is not None:
                        log.seek(0)
                        print(log.read(), file=sys.stderr)

    def _wait(self, process: subprocess.Popen[str], base: str, path: str) -> None:
        """Wait until *path* answers: 200 for the dev server's docs, any status otherwise."""

        until = time.monotonic() + 60
        while time.monotonic() < until:
            if process.poll() is not None:
                raise RuntimeError("CLI server exited during startup")
            try:
                with urllib.request.urlopen(f"{base}{path}", timeout=1) as response:  # noqa: S310
                    if response.status == 200:
                        return
            except urllib.error.HTTPError:
                if path != "/docs":
                    return
                time.sleep(0.1)
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
