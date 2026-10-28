"""Outbound proxies for a key-set fetch, as `urllib.request` reads them."""

from __future__ import annotations

from collections.abc import Mapping
from urllib.parse import urlsplit

_DEFAULT_PORTS = {"http": 80, "https": 443}


def with_default_ports(proxies: Mapping[str, str]) -> dict[str, str]:
    """*proxies* (as `getproxies()` returns them) with each proxy's port explicit.

    The `no` entry is the `NO_PROXY` bypass list, not a proxy, and is kept as
    it is.

    urllib connects to a port-less proxy on the *target's* default port, so an
    `http://proxy` serving an https URL is dialled on 443. A proxy URL's own
    scheme decides its port: 80 for `http://`, which is also what a proxy
    without a scheme is.
    """

    return {
        scheme: proxy if scheme == "no" else _with_default_port(proxy)
        for scheme, proxy in proxies.items()
    }


def _with_default_port(proxy: str) -> str:
    url = proxy if "://" in proxy else f"http://{proxy}"
    parts = urlsplit(url)
    default = _DEFAULT_PORTS.get(parts.scheme)
    try:
        port = parts.port
    except ValueError:
        return proxy  # not a URL we can improve on; urllib reports it
    if not parts.hostname or port is not None or default is None:
        return url
    return parts._replace(netloc=f"{parts.netloc}:{default}").geturl()
