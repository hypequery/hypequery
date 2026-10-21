"""Whether ClickHouse stops a query when the driver's HTTP request closes.

clickhouse-connect turns on ``cancel_http_readonly_queries_on_client_close``
for every query when the user may change it, which a ``readonly = 1`` profile
forbids. Every query this package sends is read-only, so with the setting on,
closing the request is itself a cancellation and KILL retries can stop there.
"""

from __future__ import annotations


def cancels_on_close(client: object) -> bool:
    getter = getattr(client, "get_client_setting", None)
    if not callable(getter):
        return False
    value: object = getter("cancel_http_readonly_queries_on_client_close")
    return value == "1"
