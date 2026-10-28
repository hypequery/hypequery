"""The host a request was addressed to, from its raw `Host` header."""

from __future__ import annotations

import ipaddress
import re

#: A name or a bracketed IPv6 literal, then an optional port. Header values are
#: latin-1 decoded, so anything outside ASCII never matches.
_REQUEST_HOST = re.compile(r"([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::([0-9]{1,5}))?")


def normalise_host(host: str) -> str | None:
    """*host* in the one form hosts are compared in, or None when it is not a host.

    A name is lowercased and loses a trailing dot, so `API.Example.com.` is
    `api.example.com`. An IPv6 literal keeps its brackets and is compressed,
    so `[0:0::1]` is `[::1]`.
    """

    if host.startswith("["):
        try:
            address = ipaddress.IPv6Address(host[1:-1])
        except ValueError:
            return None
        return f"[{address.compressed}]"
    name = host.lower().removesuffix(".")
    return name or None


def request_host(value: str) -> str | None:
    """The normalised host *value* names, without its port, or None when malformed.

    A port above 65535 is malformed.
    """

    match = _REQUEST_HOST.fullmatch(value)
    if match is None or (match[2] is not None and int(match[2]) > 65535):
        return None
    return normalise_host(match[1])
