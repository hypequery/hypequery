"""Where a tools client may send a bearer token."""

from __future__ import annotations

from urllib.parse import urlsplit


def _is_loopback(host: str) -> bool:
    return host in ("localhost", "127.0.0.1", "::1") or host.endswith(".localhost")


def tools_endpoint_url(url: str) -> str:
    """The tenant MCP endpoint, refused unless the token would travel over HTTPS.

    Plain HTTP is allowed only to this machine, for an endpoint run locally:
    the same rule as `@hypequery/agent` and `mint_agent_token()`.
    """

    if not isinstance(url, str):
        raise TypeError("hypequery tools: url must be a string.")
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if not host or parts.scheme not in ("http", "https"):
        raise ValueError(
            "hypequery tools: url must be the tenant MCP endpoint, "
            'for example "https://<endpoint>.hypequery.app/mcp".'
        )
    if parts.scheme == "http" and not _is_loopback(host):
        raise ValueError(
            "hypequery tools: url must use https, so the token is not sent unencrypted "
            "(plain http is allowed for localhost only)."
        )
    return url
