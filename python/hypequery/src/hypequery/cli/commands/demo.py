"""A sample semantic layer on embedded ClickHouse, served to an agent with no setup."""

from __future__ import annotations

import shlex
import sys
from importlib.util import find_spec

import anyio

from ..errors import CliError
from ..options import DemoOptions
from ..utils.mcp_setup import DEMO_REQUIREMENT, demo_command, demo_server_config

#: The tenant whose rows the self-test compares against.
_OTHER_TENANT = {"acme": "globex", "globex": "acme"}


def run(options: DemoOptions) -> None:
    from ..demo.api import DEFAULT_TENANT

    if options.print_config:
        command = demo_command(options.tenant, default_tenant=DEFAULT_TENANT)
        print(demo_server_config(command))
        print(
            f"Claude Code: claude mcp add hypequery-demo -- {shlex.join(command)}",
            file=sys.stderr,
        )
        return
    if find_spec("chdb") is None:
        raise CliError(
            "The demo runs on embedded ClickHouse. Install: "
            f'pip install "{DEMO_REQUIREMENT}", or run: uvx --from "{DEMO_REQUIREMENT}" '
            "hypequery demo"
        )
    if not options.self_test and find_spec("mcp") is None:
        raise CliError(
            'demo serves MCP and requires the MCP SDK. Install: pip install "hypequery[mcp]", '
            "or try hypequery demo --self-test"
        )
    anyio.run(_self_test if options.self_test else _serve, options.tenant)


async def _self_test(tenant_id: str) -> None:
    from ..demo.answers import gather_answers
    from ..demo.database import connect
    from ..demo.report import render_report
    from ..demo.session import agent_for, demo_session

    other = _OTHER_TENANT[tenant_id]
    async with demo_session(tenant_id) as session:
        connection = connect(session.path)
        try:
            answers = await gather_answers(
                tenant_id=tenant_id,
                other_tenant_id=other,
                agent=session.agent,
                other_agent=await agent_for(session.api, other),
                client=session.client,
                connection=connection,
            )
        finally:
            connection.close()
    print(render_report(answers))


async def _serve(tenant_id: str) -> None:
    from hypequery.mcp import create_mcp_server, serve_stdio

    from ..demo.session import demo_session

    async with demo_session(tenant_id) as session:
        print(
            f"hypequery demo: serving 3 sample datasets over MCP stdio as tenant {tenant_id}. "
            "The database is deleted when the client disconnects.",
            file=sys.stderr,
        )
        await serve_stdio(create_mcp_server(session.agent))
