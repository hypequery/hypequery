"""The outbound proxy for a URL, chosen as `urllib.request` chooses it.

`HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` (and, on macOS and Windows, the
system settings) apply, as they do to `urlopen`. A loopback host is always
reached directly.
"""

from __future__ import annotations

import base64
from urllib.parse import SplitResult, unquote, urlsplit
from urllib.request import getproxies, proxy_bypass

from .jwt_options import LOOPBACK_HOSTS


def proxy_for(url: str) -> SplitResult | None:
    """The proxy to reach *url* through, or None to connect directly.

    Raises ValueError for a proxy that is not a plain `http://` proxy, the
    only kind a tunnel can be opened through.
    """

    host = urlsplit(url).hostname or ""
    if host in LOOPBACK_HOSTS or proxy_bypass(host):
        return None
    configured = getproxies().get(urlsplit(url).scheme)
    if not configured:
        return None
    proxy = urlsplit(configured if "://" in configured else f"http://{configured}")
    if proxy.scheme != "http" or not proxy.hostname:
        raise ValueError("a key-set proxy must be an http:// URL")
    return proxy


def proxy_headers(proxy: SplitResult) -> dict[str, str]:
    """`Proxy-Authorization` for a proxy URL carrying credentials."""

    if proxy.username is None:
        return {}
    pair = f"{unquote(proxy.username)}:{unquote(proxy.password or '')}"
    return {"Proxy-Authorization": "Basic " + base64.b64encode(pair.encode()).decode("ascii")}
