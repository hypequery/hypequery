"""Development OpenAPI and docs, generated from the routes themselves.

TypeScript's `openapi.ts` builds the document from its endpoint definitions;
this does the same from an `Api`'s routes, so no web framework is needed to
document an API. Schemas come from each route's Pydantic input and output.
Both routes are public and exist only when an API is created with
``development_docs=True``, which a production profile refuses.
"""

from __future__ import annotations

from typing import Literal

from pydantic import TypeAdapter
from pydantic.json_schema import JsonSchemaValue

from .api import Api, Call, Route
from .jwt_auth import JwtStrategy
from .messages import ServeResponse
from .openapi_info import OpenApiInfo
from .utils.docs_html import docs_html
from .utils.operation_ids import operation_id, operation_summary

OPENAPI_PATH = "/openapi.json"
DOCS_PATH = "/docs"

_REF_TEMPLATE = "#/components/schemas/{model}"

#: The canonical error envelope every route answers its errors in.
_ERROR_SCHEMA: JsonSchemaValue = {
    "type": "object",
    "properties": {
        "error": {
            "type": "object",
            "properties": {
                "type": {"type": "string"},
                "message": {"type": "string"},
                "details": {"type": "object"},
            },
            "required": ["type", "message"],
        }
    },
    "required": ["error"],
}


_Mode = Literal["validation", "serialization"]


def openapi_document(
    api: Api, info: OpenApiInfo | None = None, *, mount_path: str | None = None
) -> dict[str, object]:
    """The OpenAPI 3.1 document for the routes *api* serves.

    *info* overrides the API's own `create_api(openapi=...)`. *mount_path*,
    the server URL the paths are relative to, defaults to the API's
    `client_mount_path`. Only the route that serves a method and path is
    described, the first registered, as in `Api.match`; a later route for the
    same method and path is never served.
    """

    info = info or api.openapi or OpenApiInfo()
    served: dict[tuple[str, str], Route] = {}
    for route in api.routes:
        served.setdefault((route.method, route.path), route)
    routes = [route for route in served.values() if route.documented]
    inputs: list[tuple[int, _Mode, TypeAdapter[object]]] = []
    for index, route in enumerate(routes):
        if route.input is not None:
            inputs.append((index, "validation", route.input))
        if route.output is not None:
            inputs.append((index, "serialization", route.output))
    schemas, definitions = TypeAdapter.json_schemas(inputs, ref_template=_REF_TEMPLATE)
    scheme = _security_scheme(api)
    paths: dict[str, dict[str, object]] = {}
    for index, route in enumerate(routes):
        operation = _operation(
            route,
            schemas.get((index, "validation")),
            schemas.get((index, "serialization")),
        )
        if not route.public:
            operation["security"] = [{"credential": []}]
        paths.setdefault(route.path, {})[route.method.lower()] = operation
    components: dict[str, object] = {"securitySchemes": {"credential": scheme}}
    if definitions.get("$defs"):
        components["schemas"] = definitions["$defs"]
    document_info: dict[str, object] = {"title": info.title, "version": info.version}
    if info.description is not None:
        document_info["description"] = info.description
    document: dict[str, object] = {
        "openapi": "3.1.0",
        "info": document_info,
        "paths": paths,
        "components": components,
    }
    server = api.client_mount_path if mount_path is None else mount_path
    if server:
        document["servers"] = [{"url": server}]
    return document


def _operation(
    route: Route, body: JsonSchemaValue | None, output: JsonSchemaValue | None
) -> dict[str, object]:
    operation: dict[str, object] = {
        "operationId": operation_id(route.name, route.path, route.method),
        "summary": route.summary or operation_summary(route.name),
    }
    if route.tags:
        operation["tags"] = list(route.tags)
    if body is not None:
        operation["requestBody"] = {
            "required": True,
            "content": {"application/json": {"schema": body}},
        }
    operation["responses"] = {
        "200": {
            "description": "Successful response",
            "content": {"application/json": {"schema": output if output is not None else {}}},
        },
        "default": {
            "description": "Error response",
            "content": {"application/json": {"schema": _ERROR_SCHEMA}},
        },
    }
    return operation


def _security_scheme(api: Api) -> dict[str, str]:
    transport = api.authentication.credentials
    if transport.kind == "bearer" and transport.header == "authorization":
        if isinstance(api.authentication.authenticate, JwtStrategy):
            return {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
        return {"type": "http", "scheme": "bearer"}
    return {"type": "apiKey", "in": "header", "name": transport.header}


def add_docs_routes(api: Api) -> None:
    """Serve `GET /openapi.json` and `GET /docs` on *api*, publicly.

    The document is built per request, so it describes routes added after
    these too.
    """

    async def openapi(call: Call) -> ServeResponse:
        return ServeResponse.json(openapi_document(api, mount_path=call.host.mount_path))

    page = docs_html("openapi.json", (api.openapi or OpenApiInfo()).title).encode("utf-8")

    async def docs(call: Call) -> ServeResponse:
        return ServeResponse(
            status=200, headers={"content-type": "text/html; charset=utf-8"}, body=page
        )

    api.add_route("GET", OPENAPI_PATH, openapi, public=True, documented=False)
    api.add_route("GET", DOCS_PATH, docs, public=True, documented=False)
