"""What `hypequery mcp` needs before it serves: credentials, the app, client config."""

from __future__ import annotations

import importlib
import json
import re
import sys
from collections.abc import Mapping, Sequence
from contextlib import redirect_stdout
from pathlib import Path

from ...serve import Api
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
    if key and "authorization" not in headers:
        headers["authorization"] = f"Bearer {key}"
    return headers


def load_api(target: str) -> Api:
    """Import *target* (``module:attribute``) from the current directory as an `Api`.

    The import writes to stderr: stdout belongs to the MCP protocol.
    """

    if len(target) > 512 or not _TARGET.fullmatch(target):
        raise CliError("Use module:attribute for the API, such as app:api.")
    module_name, attribute = target.split(":")
    sys.path.insert(0, str(Path.cwd()))
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
    finally:
        sys.path.remove(str(Path.cwd()))
    api = getattr(value, "api", value)
    if not isinstance(api, Api):
        raise CliError(f"{target} is not a hypequery Api (from create_api) or its ASGI app.")
    return api


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
