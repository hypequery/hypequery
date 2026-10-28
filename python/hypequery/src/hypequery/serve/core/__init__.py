"""The framework-neutral serving core (decision 0023, step 1).

Nothing here imports a web framework; an import-linter contract keeps it that
way. An adapter turns its framework's request into a `ServeRequest`, calls
`Api.handle` (or, from the FastAPI layer, `Api.dispatch` for a route it has
already matched), and writes the `ServeResponse` back.

This package is internal until step 3 makes `create_api(auth=...)` and the
pure-ASGI adapter public.
"""

from __future__ import annotations

from .api import Api, Call, Route
from .messages import Headers, QueryParams, ServeRequest, ServeResponse

__all__ = ["Api", "Call", "Headers", "QueryParams", "Route", "ServeRequest", "ServeResponse"]
