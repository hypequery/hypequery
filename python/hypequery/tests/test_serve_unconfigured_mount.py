"""A prefix the server reports never names contract paths, but is reported once."""

from __future__ import annotations

import logging

import pytest

from asgi_client import AsgiClient
from hypequery.serve import Api, Principal, create_api, to_asgi_app, to_wsgi_app
from hypequery.serve.utils.unconfigured_mount import UnconfiguredMount
from wsgi_client import environ


def _api(client_mount_path: str = "") -> Api:
    return create_api(
        auth=lambda credential: Principal(subject="reader"), client_mount_path=client_mount_path
    )


def _warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == "hypequery.serve"]


def test_asgi_warns_once_below_an_unconfigured_root_path(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.WARNING, "hypequery.serve")
    with AsgiClient(to_asgi_app(_api()), root_path="/analytics") as http:
        http.get("/analytics/missing")
        http.get("/analytics/missing")
    messages = _warnings(caplog)
    assert len(messages) == 1
    assert "client_mount_path='/analytics'" in messages[0]


@pytest.mark.parametrize(("mount", "root"), [("/analytics", "/analytics"), ("", "")])
def test_asgi_is_quiet_when_the_mount_is_configured(
    caplog: pytest.LogCaptureFixture, mount: str, root: str
) -> None:
    caplog.set_level(logging.WARNING, "hypequery.serve")
    with AsgiClient(to_asgi_app(_api(mount)), root_path=root) as http:
        http.get(f"{root}/missing")
    assert _warnings(caplog) == []


def test_wsgi_warns_once_below_an_unconfigured_script_name(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.WARNING, "hypequery.serve")
    app = to_wsgi_app(_api())
    for _ in range(2):
        app(environ("GET", "/missing", script_name="/analytics"), lambda *_: None)
    messages = _warnings(caplog)
    assert len(messages) == 1
    assert "client_mount_path='/analytics'" in messages[0]


def test_a_long_or_hostile_prefix_is_bounded_and_escaped(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.WARNING, "hypequery.serve")
    UnconfiguredMount().check(_api(), "/x\n" + "y" * 1000)
    (message,) = _warnings(caplog)
    assert "\n" not in message
    assert len(message) < 800
