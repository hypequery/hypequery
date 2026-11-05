"""Serve an API's client contract to AI agents over MCP stdio."""

from __future__ import annotations

import os
import sys
from importlib.util import find_spec
from pathlib import Path
from typing import TYPE_CHECKING

import anyio

from ..errors import CliError
from ..options import McpOptions
from ..utils.mcp_setup import app_lifespan, load_api, mcp_server_config, request_headers

if TYPE_CHECKING:
    from ...serve.asgi import Lifespan


def _project(options: McpOptions) -> Path:
    if options.project is None:
        return Path.cwd()
    project = Path(options.project).resolve()
    if not project.is_dir():
        raise CliError(f"--project {options.project} is not a directory.")
    os.chdir(project)
    return project


def run(options: McpOptions) -> None:
    project = _project(options)
    headers = request_headers(options.headers, os.environ)
    if options.print_config:
        if options.headers:
            # A printed config would either lose the header or leak its value.
            raise CliError(
                "--print-config cannot carry --header; put the credential in "
                "HYPEQUERY_API_KEY, which the config reads from the client's environment."
            )
        print(
            mcp_server_config(
                app=options.app,
                client_contract_url=options.client_contract_url,
                project=project,
                uses_key="authorization" in headers,
            )
        )
        return
    if not options.self_test and find_spec("mcp") is None:
        raise CliError('mcp requires the MCP SDK. Install: pip install "hypequery[mcp]"')

    from hypequery.mcp import (
        ApiContractBackend,
        ClientContractExecutor,
        ContractBackend,
        HttpContractBackend,
        McpToolError,
    )

    backend: ContractBackend
    lifespan: Lifespan | None = None
    if options.client_contract_url is not None:
        try:
            backend = HttpContractBackend(options.client_contract_url, headers=headers)
        except ValueError as exc:
            raise CliError(str(exc)) from None
    else:
        loaded = load_api(options.app or "app:api")
        lifespan = loaded.lifespan
        try:
            backend = ApiContractBackend(loaded.api, headers=headers)
        except ValueError as exc:
            # A setup mistake, such as an API without a client-contract endpoint.
            raise CliError(str(exc)) from None

    async def main() -> None:
        async with app_lifespan(lifespan):
            await serve()

    async def serve() -> None:
        try:
            executor = await ClientContractExecutor.create(backend)
        except McpToolError as exc:
            # The executor's messages never echo a URL, credential or backend body.
            raise CliError(f"Could not read the client contract: {exc.message}") from None
        except Exception:
            # Project code may put URLs, SQL or credentials in its errors.
            raise CliError(
                "Could not read the client contract; check the app, its dependencies "
                "and environment."
            ) from None
        endpoints = executor.contract["endpoints"]
        if options.self_test:
            queryable = sum(1 for e in endpoints if e["kind"] == "dataset")
            print(
                f"hypequery MCP is ready: 4 tools over {len(endpoints)} authorized endpoints "
                f"({queryable} dataset, {len(endpoints) - queryable} metric). "
                "No query tool was called.",
                file=sys.stderr,
            )
            return
        if not endpoints:
            print(
                "hypequery MCP: this principal sees no endpoints; check the credential and "
                "that endpoints set client_profile=ClientQueryProfile().",
                file=sys.stderr,
            )
        from hypequery.mcp import create_mcp_server, serve_stdio

        print("hypequery MCP serving over stdio.", file=sys.stderr)
        await serve_stdio(create_mcp_server(executor))

    anyio.run(main)
