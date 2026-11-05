"""What `hypequery mcp` needs before it serves: credentials, the app, client config."""

from __future__ import annotations

import importlib
import json
import re
import sys
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager, redirect_stdout
from dataclasses import dataclass
from pathlib import Path

from ...serve import Api
from ...serve.asgi import AsgiApp, Lifespan
from ..errors import CliError

API_KEY_VARIABLE = "HYPEQUERY_API_KEY"
DEFAULT_APP = "app:api"
_TARGET = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*:[A-Za-z_][A-Za-z0-9_]*")
_HEADER_NAME = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+")


def request_headers(values: Sequence[str], env: Mapping[str, str]) -> dict[str, str]:
    """`--header` values, plus `HYPEQUERY_API_KEY` as a bearer token unless one is given."""

    headers: dict[str, str] = {}
    for value in values:
        name, separator, content = value.partition(":")
        name, content = name.strip(), content.strip()
        if not separator or not _HEADER_NAME.fullmatch(name) or not content:
            raise CliError("Use --header 'Name: value'.")
        headers[name.lower()] = content
    key = env.get(API_KEY_VARIABLE, "").strip()
    if key.startswith("${"):
        # A client that does not expand variables passed the printed placeholder.
        raise CliError(
            f"{API_KEY_VARIABLE} is the unexpanded placeholder {key}; set the key itself "
            "in the MCP client's env."
        )
    if key and "authorization" not in headers:
        headers["authorization"] = f"Bearer {key}"
    return headers


@dataclass(frozen=True, slots=True)
class LoadedApp:
    """The served `Api`, and the lifespan its ASGI app would run around it."""

    api: Api
    lifespan: Lifespan | None = None


def load_api(target: str) -> LoadedApp:
    """Import *target* (``module:attribute``) from the current directory as an `Api`.

    The import writes to stderr: stdout belongs to the MCP protocol.
    """

    if len(target) > 512 or not _TARGET.fullmatch(target):
        raise CliError("Use module:attribute for the API, such as app:api.")
    module_name, attribute = target.split(":")
    # The project stays importable: auth callables and handlers may import its
    # modules lazily, during a tool call, long after this import.
    project = str(Path.cwd())
    if project not in sys.path:
        sys.path.insert(0, project)
    try:
        with redirect_stdout(sys.stderr):
            value = getattr(importlib.import_module(module_name), attribute)
    except ModuleNotFoundError as exc:
        if exc.name is not None and exc.name.split(".")[0] == "clickhouse_connect":
            raise CliError(
                'Install the database driver: pip install "hypequery[clickhouse]"'
            ) from exc
        raise CliError(
            f"Cannot import {target}; run from the project directory or pass --project."
        ) from exc
    except AttributeError as exc:
        raise CliError(f"{module_name} has no attribute {attribute}.") from exc
    except Exception as exc:
        # Project code may put URLs, SQL or credentials in its errors.
        raise CliError("App import failed; check its dependencies and environment.") from exc
    api = getattr(value, "api", value)
    if not isinstance(api, Api):
        raise CliError(f"{target} is not a hypequery Api (from create_api) or its ASGI app.")
    # An ASGI app's lifespan opens what its endpoints share (an executor, a
    # pool), so the MCP server runs it too, as a web server would.
    return LoadedApp(api, value.lifespan if isinstance(value, AsgiApp) else None)


@asynccontextmanager
async def app_lifespan(factory: Lifespan | None) -> AsyncIterator[None]:
    """Enter the app's lifespan for the server's life, as an ASGI server does."""

    if factory is None:
        yield
        return
    # stdout carries the MCP protocol, so the app's own startup and shutdown
    # output goes to stderr, as during import. Project code may put URLs, SQL
    # or credentials in its errors, so neither failure echoes them.
    try:
        with redirect_stdout(sys.stderr):
            context = factory()
            await context.__aenter__()
    except Exception:
        raise CliError("The app's lifespan failed to start; check its dependencies.") from None
    try:
        yield
    except BaseException as exc:
        try:
            with redirect_stdout(sys.stderr):
                suppressed = await context.__aexit__(type(exc), exc, exc.__traceback__)
        except Exception:
            # The serving failure is the one to report; a failed cleanup after
            # it would only hide that.
            raise exc from None
        if not suppressed:
            raise
    else:
        try:
            with redirect_stdout(sys.stderr):
                await context.__aexit__(None, None, None)
        except Exception:
            raise CliError("The app's lifespan failed to shut down cleanly.") from None


def mcp_server_config(
    *, app: str | None, client_contract_url: str | None, project: Path, uses_key: bool
) -> str:
    """An `mcpServers` entry that launches this command from *project* over stdio."""

    # This interpreter, by absolute path: MCP clients launch with a minimal PATH
    # that rarely includes the project's virtual environment.
    command = sys.executable
    args = ["-m", "hypequery", "mcp"]
    if client_contract_url is not None:
        args += ["--client-contract-url", client_contract_url]
    else:
        args += [app or DEFAULT_APP, "--project", str(project)]
    server: dict[str, object] = {"command": command, "args": args}
    if uses_key:
        # Never the key itself: the client fills it from its own environment.
        server["env"] = {API_KEY_VARIABLE: f"${{{API_KEY_VARIABLE}}}"}
    return json.dumps({"mcpServers": {"hypequery": server}}, indent=2)
