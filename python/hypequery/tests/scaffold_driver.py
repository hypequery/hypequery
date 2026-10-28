"""Import a generated project's app in a fresh process and serve requests to it.

Run as ``python scaffold_driver.py <framework> <project>`` with a JSON spec on
stdin, ``{"rows": {"columns": [...], "rows": [[...]]}, "requests": [...]}``;
prints ``[[status, body], ...]``. Each request is ``{"method", "path",
"headers", "json", "signed_in", "csrf"}``; ``csrf`` sends a matching Django
CSRF cookie and ``X-CSRFToken`` header, as the React client does. A fresh
process because Django's settings can be configured once per process, and the projects' ``app`` and ``datasets``
modules would shadow each other. ClickHouse is a double answering ``rows``;
importing a project must not connect.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest

from hypequery.datasets import CompiledQuery
from hypequery.execution import ClickHouseConnection, QueryRows

Reply = tuple[int, Any]
#: Undone when the process exits.
PATCH = pytest.MonkeyPatch()


class RowsExecutor:
    """Answers every query with the spec's rows."""

    def __init__(self, rows: QueryRows) -> None:
        self.rows = rows

    def execute(self, compiled: CompiledQuery) -> QueryRows:
        return self.rows

    def close(self) -> None:
        pass


def _body(content: bytes) -> Any:
    try:
        return json.loads(content)
    except ValueError:
        return content.decode(errors="replace")


def standalone(requests: list[dict[str, Any]], rows: QueryRows) -> list[Reply]:
    import httpx

    import hypequery.execution

    PATCH.setattr(
        hypequery.execution, "create_clickhouse_executor", lambda *_, **__: RowsExecutor(rows)
    )
    app = importlib.import_module("app")

    async def send(request: dict[str, Any]) -> Reply:
        transport = httpx.ASGITransport(app=app.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as http:
            response = await http.request(
                request["method"],
                request["path"],
                json=request.get("json"),
                headers=request.get("headers", {}),
            )
            return response.status_code, _body(response.content)

    return [asyncio.run(send(request)) for request in requests]


def _patch_process_clients(rows: QueryRows) -> None:
    from hypequery.contrib.utils import process_clients

    def build(connection: ClickHouseConnection, **_: object) -> RowsExecutor:
        return RowsExecutor(rows)

    PATCH.setattr(process_clients, "create_clickhouse_executor", build)


def django(requests: list[dict[str, Any]], rows: QueryRows) -> list[Reply]:
    _patch_process_clients(rows)
    os.environ["DJANGO_SETTINGS_MODULE"] = "settings"
    import django
    from django.core.management import call_command

    django.setup()
    call_command("migrate", verbosity=0, interactive=False)
    from django.conf import settings
    from django.contrib.auth.models import User
    from django.middleware.csrf import get_token
    from django.test import Client, RequestFactory

    user, _ = User.objects.get_or_create(username="analyst")
    replies = []
    for request in requests:
        # As a browser is: Django's CSRF middleware checks every unsafe request.
        http = Client(HTTP_HOST="localhost", enforce_csrf_checks=True)
        if request.get("signed_in"):
            http.force_login(user)
        headers = dict(request.get("headers", {}))
        if request.get("csrf"):
            token = get_token(RequestFactory().get("/"))
            http.cookies[settings.CSRF_COOKIE_NAME] = token
            headers["X-CSRFToken"] = token
        body = request.get("json")
        response = http.generic(
            request["method"],
            request["path"],
            json.dumps(body) if body is not None else "",
            content_type="application/json",
            headers=headers,
        )
        replies.append((response.status_code, _body(response.content)))
    return replies


def flask(requests: list[dict[str, Any]], rows: QueryRows) -> list[Reply]:
    _patch_process_clients(rows)
    app = importlib.import_module("app")

    replies = []
    for request in requests:
        http = app.app.test_client()
        if request.get("signed_in"):
            with http.session_transaction() as session:
                session["user_id"] = "analyst"
        response = http.open(
            request["path"],
            method=request["method"],
            json=request.get("json"),
            headers=request.get("headers", {}),
        )
        replies.append((response.status_code, _body(response.data)))
    return replies


def main() -> None:
    framework, project = sys.argv[1], Path(sys.argv[2])
    spec = json.load(sys.stdin)
    os.chdir(project)
    sys.path.insert(0, str(project))
    rows = QueryRows(
        tuple(spec["rows"]["columns"]), tuple(tuple(row) for row in spec["rows"]["rows"])
    )
    serve = {"standalone": standalone, "django": django, "flask": flask}[framework]
    print(json.dumps(serve(spec["requests"], rows)))


if __name__ == "__main__":
    main()
