"""`hypequery mcp --http` settings: validated before anything is imported or served.

Mirrors TypeScript's `utils/mcp-http-server.ts`, so both CLIs accept the same
flags and refuse the same unsafe combinations.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from ..errors import CliError

#: The key MCP clients send to a server started with ``--http``. Distinct from the backend key.
MCP_SERVER_KEY_VARIABLE = "HYPEQUERY_MCP_KEY"

LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "[::1]")
_LOOPBACK_BINDS = frozenset({"127.0.0.1", "localhost", "::1"})
DEFAULT_PORT = 3333


@dataclass(frozen=True, slots=True)
class McpHttpSettings:
    port: int
    host: str
    allowed_hosts: tuple[str, ...]
    allowed_origins: tuple[str, ...]
    resource: str | None
    authorization_servers: tuple[str, ...]
    required_scopes: tuple[str, ...]
    static_key: str | None


def _list(value: str | None) -> tuple[str, ...]:
    return tuple(item.strip() for item in (value or "").split(",") if item.strip())


def mcp_http_settings(
    *,
    port: int | None,
    host: str | None,
    allowed_hosts: str | None,
    allowed_origins: str | None,
    resource: str | None,
    authorization_servers: str | None,
    required_scopes: str | None,
    env: Mapping[str, str],
) -> McpHttpSettings:
    """The ``--http`` flags, checked; the static key comes from the environment."""

    chosen_port = DEFAULT_PORT if port is None else port
    if not 0 <= chosen_port <= 65535:
        raise CliError("--port must be a port number.")
    bind = host or "127.0.0.1"
    servers = _list(authorization_servers)
    if (resource or servers or required_scopes) and not (resource and servers):
        raise CliError(
            "OAuth needs both --resource and --authorization-servers, for example: "
            "hypequery mcp --http --resource https://mcp.example.com/mcp "
            "--authorization-servers https://auth.example.com"
        )
    hosts = _list(allowed_hosts)
    if not hosts:
        if resource:
            hosts = (urlsplit(resource).hostname or "", *LOOPBACK_HOSTS)
        elif bind in _LOOPBACK_BINDS:
            hosts = LOOPBACK_HOSTS
        else:
            raise CliError(
                f"--host {bind} accepts network traffic, so name the hosts it answers with "
                "--allowed-hosts (checking Host protects against DNS rebinding)."
            )
    key = env.get(MCP_SERVER_KEY_VARIABLE, "").strip() or None
    if key and resource:
        raise CliError(f"{MCP_SERVER_KEY_VARIABLE} and OAuth are alternatives; unset one.")
    return McpHttpSettings(
        port=chosen_port,
        host=bind,
        allowed_hosts=hosts,
        allowed_origins=_list(allowed_origins),
        resource=resource,
        authorization_servers=servers,
        required_scopes=_list(required_scopes),
        static_key=key,
    )
