"""Bind addresses a local server may listen on."""

from __future__ import annotations

import ipaddress


def is_loopback(host: str) -> bool:
    """Whether *host* is ``localhost`` or a loopback IP address.

    Any other name is refused: whether a DNS name resolves to loopback is not
    something the runner can promise, so it does not guess.
    """

    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError as exc:
        raise ValueError(
            f"host {host!r} must be 'localhost' or an IP address such as 127.0.0.1"
        ) from exc
