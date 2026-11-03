"""A scaffold on embedded ClickHouse (chDB) instead of a ClickHouse server.

``init --database chdb`` renders the project as it would for a server, then
this swaps every server-specific part: the app opens the chDB database beside
it, the project installs the ``chdb`` extra, there are no connection settings,
and the README seeds and regenerates against the database directory. Only the
standalone and FastAPI apps are offered: the Django and Flask integrations
connect to a ClickHouse server.
"""

from __future__ import annotations

import re
from pathlib import PurePosixPath

from ..errors import CliError
from ..utils.generated_literals import gitignore_directory, quoted
from ..utils.markdown_sections import markdown_sections
from .framework_apps import NAMES, TOKEN_EXPORT, Framework
from .readme_notes import CANCELLATION

#: Where init puts the database, relative to the project directory.
DEFAULT_CHDB_PATH = "analytics.chdb"
#: The apps whose executor init can point at chDB.
CHDB_FRAMEWORKS: tuple[Framework, ...] = ("standalone", "fastapi")

_SERVER_IMPORT = (
    "from hypequery.execution import ClickHouseConnection, create_clickhouse_executor\n"
)
_SERVER_EXECUTOR = (
    "# Reads CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, _DATABASE, _USERNAME, _PASSWORD"
    " and _SECURE.\n"
    "executor = create_clickhouse_executor(ClickHouseConnection.from_env())\n"
)
_SERVER_DOCSTRING = "The connection comes from CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, ...\n"
_SERVER_REQUIREMENT = "Requires Python 3.11+ and an existing ClickHouse server."

CHDB_NOTES = """
## Embedded ClickHouse

chDB runs ClickHouse inside the app's process. One process at a time can open
the database directory: stop the app before seeding or running
`hypequery generate datasets`, and run one server process, not several workers.
A running query cannot be cancelled: it stops at its `max_execution_time`, which
hypequery shortens to the request's remaining time in whole seconds, so a
request that times out can finish up to a second late.
"""


def require_chdb_framework(framework: Framework) -> None:
    if framework not in CHDB_FRAMEWORKS:
        raise CliError(
            f"--database chdb scaffolds the standalone or FastAPI app; the {NAMES[framework]} "
            "integration connects to a ClickHouse server."
        )


def chdb_path_literal(path: str) -> str:
    """The app's expression for *path*: beside app.py when relative, else as given."""

    if PurePosixPath(path).is_absolute() or re.match(r"^[A-Za-z]:[\\/]", path):
        return quoted(path)
    return f"str(Path(__file__).parent / {quoted(path)})"


def _app(source: str, path: str) -> str:
    if _SERVER_IMPORT not in source or _SERVER_EXECUTOR not in source:
        raise ValueError("app template no longer creates the ClickHouse executor as expected")
    source = source.replace(
        _SERVER_IMPORT, "from hypequery.execution import create_chdb_executor\n"
    ).replace(
        _SERVER_EXECUTOR,
        "# Embedded ClickHouse (chDB): no server, and no connection settings.\n"
        f"executor = create_chdb_executor({chdb_path_literal(path)})\n",
    )
    source = source.replace(
        _SERVER_DOCSTRING, "Queries run on embedded ClickHouse (chDB); no server is needed.\n"
    )
    # A stdlib import, placed as isort would: after `import secrets`, or first.
    if "import secrets\n" in source:
        return source.replace("import secrets\n", "import secrets\nfrom pathlib import Path\n", 1)
    first_import = "\nfrom datasets import datasets\n"
    return source.replace(first_import, "\nfrom pathlib import Path\n" + first_import, 1)


def _env_example(source: str) -> str:
    kept = [
        line
        for line in source.splitlines(keepends=True)
        if not line.startswith("CLICKHOUSE_")
        and not line.startswith(("# Optional: cancel queries", "# Unset, the query user"))
    ]
    return "".join(kept) + "# chDB runs in-process: there are no connection settings.\n"


def _configure(framework: Framework, path: str) -> str:
    token = (
        "Export a development token in the shell you run the app from:\n\n"
        f"```bash\n{TOKEN_EXPORT}```\n\n"
        "The token is for local development; use your real authentication before\n"
        "exposing the app to users.\n\n"
        if framework == "fastapi"
        else ""
    )
    return (
        "## Configure\n\n"
        f"{token}The app opens the embedded chDB database at `{path}`, relative to\n"
        "`app.py`: there is no server to run and no connection settings to set.\n\n"
    )


def _seed(path: str) -> str:
    return f"""## Create sample data

Review `seed.sql`, then run it explicitly. Scaffolding and the app never seed
it automatically, and repeating the seed inserts the sample rows again. Stop
the app first: one process at a time can open the database.

```bash
python - <<'PY'
from pathlib import Path
import chdb

connection = chdb.connect({quoted(path)})
try:
    for statement in Path("seed.sql").read_text().split(";"):
        if statement.strip():
            connection.query(statement)
finally:
    connection.close()
PY
```

"""


def _readme(readme: str, framework: Framework, path: str) -> str:
    sections = []
    for title, text in markdown_sections(readme):
        if title == "Configure":
            text = _configure(framework, path)
        elif title == "Create sample data":
            text = _seed(path)
        sections.append(text)
    result = "".join(sections)
    required = {
        _SERVER_REQUIREMENT: "Requires Python 3.11+ on Linux or macOS. Queries run on embedded\n"
        "ClickHouse (chDB), so no server is needed.",
        "[server,clickhouse]": "[server,chdb]",
        CANCELLATION: CHDB_NOTES,
    }
    for old, new in required.items():
        if old not in result:
            raise ValueError(f"README template no longer has {old.strip()[:40]!r}")
        result = result.replace(old, new)
    # Only the schema-backed standalone README says this.
    return result.replace("Use the same connection settings as schema discovery. ", "")


def chdb_templates(templates: dict[str, str], framework: Framework, path: str) -> dict[str, str]:
    """*templates*, rendered for a server, rewritten for the chDB database at *path*."""

    require_chdb_framework(framework)
    result = templates.copy()
    result["app.py"] = _app(templates["app.py"], path)
    pyproject = templates["pyproject.toml"]
    result["pyproject.toml"] = (
        pyproject.replace("hypequery[server,clickhouse]", "hypequery[server,chdb]")
        + "\n[tool.hypequery]\n"
        "# The embedded chDB database app.py opens and `hypequery generate datasets` reads,\n"
        "# relative to this file.\n"
        f"chdb-path = {quoted(path)}\n"
    )
    result[".env.example"] = _env_example(templates[".env.example"])
    if not PurePosixPath(path).is_absolute() and ".." not in PurePosixPath(path).parts:
        result[".gitignore"] = templates[".gitignore"] + gitignore_directory(path) + "\n"
    result["README.md"] = _readme(templates["README.md"], framework, path)
    return result
