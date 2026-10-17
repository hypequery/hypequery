"""Count budgets run on the detached JSON tree before descriptor validation."""

from typing import cast

from .errors import client_error


def bound_client_descriptors(raw: dict[str, object]) -> None:
    if type(raw.get("endpoints")) is not list:
        return
    endpoints = cast(list[object], raw["endpoints"])
    if len(endpoints) > 256:
        client_error("HQ_CLIENT_LIMIT", "/endpoints")
    descriptors = 0
    for index, endpoint in enumerate(endpoints):
        if type(endpoint) is not dict:
            continue
        for key in ("dimensions", "measures", "filters"):
            value = cast(dict[str, object], endpoint).get(key)
            if type(value) is dict:
                count = len(cast(dict[str, object], value))
                if count > 256:
                    client_error("HQ_CLIENT_LIMIT", f"/endpoints/{index}/{key}")
                descriptors += count
                if descriptors > 16384:
                    client_error("HQ_CLIENT_LIMIT", f"/endpoints/{index}")
