"""Recognize an installed API among factory results and export its build view."""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING

from ..errors import CliError

if TYPE_CHECKING:
    from ...protocol import PreparedProtocolClientContract
    from ...serve.core.api import Api


def installed_api(value: object) -> Api | None:
    """The `Api` behind *value*, when it is one or the ASGI/WSGI app serving one.

    Only a project that imported Serve can hold one, so the CLI never imports
    it for a definition-only factory.
    """

    if "hypequery.serve" not in sys.modules:
        return None
    from ...serve import AsgiApp, WsgiApp
    from ...serve.core.api import Api

    if isinstance(value, AsgiApp | WsgiApp):
        return value.api
    return value if isinstance(value, Api) else None


def export_installed_contract(api: Api) -> PreparedProtocolClientContract:
    from ...serve import export_client_contract

    try:
        return export_client_contract(api)
    except ValueError as error:
        # Serve's own messages name routes and arguments, never project data.
        raise CliError(str(error)) from None
