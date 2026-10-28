"""The framework-neutral serving core (decision 0023).

Nothing here imports a web framework; an import-linter contract keeps it that
way. An adapter turns its framework's request into a `ServeRequest`, calls
`Api.handle`, and writes the `ServeResponse` back. `hypequery.serve` exports
the public names; `create_api` builds the `Api`.
"""

from __future__ import annotations

from .api import Api, Call, Route
from .messages import Headers, QueryParams, ServeRequest, ServeResponse

__all__ = ["Api", "Call", "Headers", "QueryParams", "Route", "ServeRequest", "ServeResponse"]
