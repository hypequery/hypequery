"""The MCP protocol adapter: an executor behind the official `mcp` SDK's server.

The only module that imports the SDK. Tools and prompts come from the
executor as plain JSON data and are validated into the SDK's types here, so
the executor stays transport-neutral and testable without a session.

Two transports: `serve_stdio`, and `create_mcp_asgi_app`, a self-hosted
Streamable HTTP app whose sessions each belong to one verified principal.
"""

from __future__ import annotations

import contextlib
import json
from collections import OrderedDict
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, Mapping
from typing import Any

import anyio
import mcp_types as types
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
from mcp.server.auth.provider import AccessToken
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.shared.exceptions import MCPError
from starlette.types import Receive, Scope, Send

from .. import __version__
from .errors import McpToolError, classify_mcp_tool_error
from .executor import ClientContractExecutor
from .http_auth import McpAuthenticator, McpAuthError, McpPrincipal
from .utils.http_guards import (
    host_allowed,
    normalize_allowed_hosts,
    normalize_allowed_origins,
    origin_allowed,
)
from .utils.oauth import BearerError, ProtectedResource, bearer_challenge

SERVER_NAME = "hypequery-mcp-server"

#: Where the HTTP app leaves the verified principal for the tool handlers.
_PRINCIPAL_SCOPE_KEY = "hypequery.mcp.principal"

#: The latest forwarded credential headers of one principal.
CredentialSource = Callable[[], Mapping[str, str]]
#: Builds the executor for a principal; *credentials* returns its latest forwarded headers.
ExecutorFactory = Callable[[McpPrincipal, CredentialSource], Awaitable[ClientContractExecutor]]

_ExecutorResolver = Callable[[Any], Awaitable[ClientContractExecutor]]


def _protocol_error(error: Exception) -> MCPError:
    """A JSON-RPC error carrying only the classified, public details of *error*.

    Anything but an `McpToolError` becomes the generic failure, so a backend's
    or driver's message never reaches the agent.
    """

    details = classify_mcp_tool_error(error)
    return MCPError(types.INTERNAL_ERROR, details["message"], data={"error": dict(details)})


def _server(resolve: _ExecutorResolver, *, name: str, version: str) -> Server[Any]:
    async def list_tools(
        context: Any, _params: types.PaginatedRequestParams | None
    ) -> types.ListToolsResult:
        try:
            executor = await resolve(context)
            return types.ListToolsResult.model_validate(await executor.list_tools())
        except Exception as error:
            raise _protocol_error(error) from None

    async def call_tool(context: Any, params: types.CallToolRequestParams) -> types.CallToolResult:
        try:
            executor = await resolve(context)
        except Exception as error:
            raise _protocol_error(error) from None
        return types.CallToolResult.model_validate(
            await executor.call_tool(params.name, params.arguments)
        )

    async def list_prompts(
        context: Any, _params: types.PaginatedRequestParams | None
    ) -> types.ListPromptsResult:
        try:
            executor = await resolve(context)
            return types.ListPromptsResult.model_validate(await executor.list_prompts())
        except Exception as error:
            raise _protocol_error(error) from None

    async def get_prompt(
        context: Any, params: types.GetPromptRequestParams
    ) -> types.GetPromptResult:
        try:
            executor = await resolve(context)
            return types.GetPromptResult.model_validate(
                await executor.get_prompt(params.name, params.arguments)
            )
        except Exception as error:
            raise _protocol_error(error) from None

    return Server(
        name,
        version=version,
        on_list_tools=list_tools,
        on_call_tool=call_tool,
        on_list_prompts=list_prompts,
        on_get_prompt=get_prompt,
    )


def create_mcp_server(
    executor: ClientContractExecutor, *, name: str = SERVER_NAME, version: str = __version__
) -> Server[Any]:
    """An MCP server exposing *executor*'s tools and its `dataset_guide` prompt."""

    async def resolve(_context: Any) -> ClientContractExecutor:
        return executor

    return _server(resolve, name=name, version=version)


async def serve_stdio(server: Server[Any]) -> None:
    """Serve *server* over this process's stdin and stdout until the client disconnects.

    stdout carries only protocol messages while serving; log to stderr.
    """

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


# --- Streamable HTTP --------------------------------------------------------


def _request_headers(scope: Scope) -> tuple[dict[str, str], set[str]]:
    """Lower-cased headers (first value wins) and the names sent more than once."""

    headers: dict[str, str] = {}
    duplicated: set[str] = set()
    for raw_name, raw_value in scope.get("headers", ()):
        name = raw_name.decode("latin-1").lower()
        if name in headers:
            duplicated.add(name)
        headers.setdefault(name, raw_value.decode("latin-1"))
    return headers, duplicated


DEFAULT_MAX_SESSIONS = 100
DEFAULT_SESSION_IDLE_TIMEOUT = 30 * 60.0
DEFAULT_MAX_REQUEST_BODY_SIZE = 1024 * 1024


async def _respond(
    send: Send,
    status: int,
    body: bytes,
    *,
    content_type: str = "text/plain; charset=utf-8",
    headers: Iterable[tuple[str, str]] = (),
    cache: str = "no-store",
) -> None:
    raw = [
        (b"content-type", content_type.encode()),
        (b"content-length", str(len(body)).encode()),
        (b"cache-control", cache.encode()),
        *((name.encode("latin-1"), value.encode("latin-1")) for name, value in headers),
    ]
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


_REASONS = {
    400: b"Bad Request",
    401: b"Unauthorized",
    403: b"Forbidden",
    404: b"Not Found",
    405: b"Method Not Allowed",
    421: b"Misdirected Request",
    500: b"Internal Server Error",
    503: b"Service Unavailable",
}


class McpAsgiApp:
    """A self-hosted Streamable HTTP MCP server, as an ASGI app.

    Every request is checked in order: ``Host`` (DNS rebinding), route,
    ``Origin``, credential, then session ownership, exactly as TypeScript's
    `createMCPHttpHandler`. Each MCP session belongs to the principal that
    opened it: another principal using its id is answered 404, like an unknown
    session. Executors are built per principal by *executor_factory*.

    Serve it with any ASGI server (it handles the lifespan protocol), or mount
    it in another app and enter `run()` from that app's lifespan.
    """

    def __init__(
        self,
        executor_factory: ExecutorFactory,
        authenticate: McpAuthenticator,
        *,
        name: str = SERVER_NAME,
        version: str = __version__,
        path: str = "/mcp",
        allowed_hosts: Iterable[str] | None = None,
        allowed_origins: Iterable[str] | None = None,
        protected_resource: ProtectedResource | None = None,
        max_sessions: int = DEFAULT_MAX_SESSIONS,
        session_idle_timeout: float = DEFAULT_SESSION_IDLE_TIMEOUT,
        max_request_body_size: int = DEFAULT_MAX_REQUEST_BODY_SIZE,
    ) -> None:
        if not callable(authenticate):
            raise TypeError("authenticate is required; every request must carry a credential")
        if not callable(executor_factory):
            raise TypeError("executor_factory is required")
        if not path.startswith("/") or "?" in path or "#" in path:
            raise ValueError("path must be an absolute path such as /mcp")
        for label, value in (
            ("max_sessions", max_sessions),
            ("max_request_body_size", max_request_body_size),
        ):
            if type(value) is not int or value <= 0:
                raise ValueError(f"{label} must be a positive integer")
        if protected_resource is not None and not isinstance(protected_resource, ProtectedResource):
            raise TypeError("protected_resource must be a ProtectedResource")
        self._factory = executor_factory
        self._authenticate = authenticate
        self._path = path
        self._hosts = normalize_allowed_hosts(allowed_hosts)
        self._origins = normalize_allowed_origins(allowed_origins)
        self._resource = protected_resource
        # One entry per open session plus one per principal; least recently used go first.
        self._max_executors = 2 * max_sessions
        self._executors: OrderedDict[str, ClientContractExecutor] = OrderedDict()
        self._credentials: dict[str, dict[str, str]] = {}
        self._creating: dict[str, anyio.Lock] = {}
        self._manager = StreamableHTTPSessionManager(
            _server(self._resolve, name=name, version=version),
            session_idle_timeout=session_idle_timeout,
            max_request_body_size=max_request_body_size,
            max_sessions=max_sessions,
        )

    @contextlib.asynccontextmanager
    async def run(self) -> AsyncIterator[None]:
        """Run the session manager; required before the app serves a request."""

        async with self._manager.run():
            yield

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self._lifespan(receive, send)
            return
        if scope["type"] != "http":
            raise RuntimeError("McpAsgiApp serves HTTP only")
        await self._http(scope, receive, send)

    async def _lifespan(self, receive: Receive, send: Send) -> None:
        await receive()
        try:
            async with self.run():
                await send({"type": "lifespan.startup.complete"})
                await receive()
        except Exception as error:  # pragma: no cover - surfaced to the ASGI server
            await send({"type": "lifespan.startup.failed", "message": str(error)})
            return
        await send({"type": "lifespan.shutdown.complete"})

    async def _refuse(
        self, send: Send, status: int, headers: Iterable[tuple[str, str]] = ()
    ) -> None:
        await _respond(send, status, _REASONS.get(status, b"Error"), headers=headers)

    async def _challenge(
        self, send: Send, error: BearerError | None, scopes: Iterable[str] = ()
    ) -> None:
        status = 403 if error == "insufficient_scope" else 401
        challenge = bearer_challenge(error, self._resource, scopes)
        await self._refuse(send, status, [("www-authenticate", challenge)])

    async def _http(self, scope: Scope, receive: Receive, send: Send) -> None:
        headers, duplicated = _request_headers(scope)
        if not await self._admit(scope, headers, send):
            return
        principal = await self._principal(headers, duplicated, send)
        if principal is None:
            return
        owner = principal.owner
        forwarded = self._authenticate.credential_headers
        self._credentials[owner] = {name: headers[name] for name in forwarded if name in headers}

        # An opening request builds this principal's executor up front, so a
        # backend that cannot serve it fails here rather than mid-session.
        if "mcp-session-id" not in headers and scope["method"] == "POST":
            try:
                await self._owner_executor(principal)
            except Exception:
                # Executor errors may name backends or credentials; none reach the client.
                await self._refuse(send, 503)
                return

        # 5. Sessions: the SDK binds each session to the user that opened it.
        user = AuthenticatedUser(
            AccessToken(token=owner, client_id=owner, scopes=sorted(principal.scopes))
        )
        await self._manager.handle_request(
            {**scope, "user": user, _PRINCIPAL_SCOPE_KEY: principal}, receive, send
        )

    async def _admit(self, scope: Scope, headers: Mapping[str, str], send: Send) -> bool:
        """Steps 1-3: Host, route (answering metadata itself) and Origin."""

        # 1. DNS rebinding: an attacker's page at a private address still sends its own Host.
        if not host_allowed(headers.get("host"), self._hosts):
            await self._refuse(send, 421)
            return False

        # 2. Routing. Metadata is public: clients read it to find the authorization server.
        path: str = scope["path"]
        root = scope.get("root_path", "")
        if root and path.startswith(root):
            path = path[len(root) :] or "/"
        if self._resource is not None and path == self._resource.metadata_path:
            if scope["method"] != "GET":
                await self._refuse(send, 405, [("allow", "GET")])
                return False
            document = json.dumps(dict(self._resource.document), separators=(",", ":")).encode()
            await _respond(
                send, 200, document, content_type="application/json", cache="public, max-age=3600"
            )
            return False
        if path != self._path:
            await self._refuse(send, 404)
            return False

        # 3. Browser pages may call only from listed origins.
        if not origin_allowed(headers.get("origin"), self._origins):
            await self._refuse(send, 403)
            return False
        return True

    async def _principal(
        self, headers: Mapping[str, str], duplicated: set[str], send: Send
    ) -> McpPrincipal | None:
        """Step 4: the verified principal, or None once a refusal was sent."""

        if duplicated.intersection(("authorization", *self._authenticate.credential_headers)):
            await self._refuse(send, 400)
            return None
        try:
            principal: object = await self._authenticate(headers)
        except McpAuthError as error:
            await self._challenge(send, error.code, error.scopes)
            return None
        except Exception:
            await self._refuse(send, 500)
            return None
        if principal is None:
            await self._challenge(send, None)
            return None
        if not isinstance(principal, McpPrincipal):
            await self._refuse(send, 500)
            return None
        required = self._resource.required_scopes if self._resource is not None else ()
        if any(scope not in principal.scopes for scope in required):
            await self._challenge(send, "insufficient_scope", required)
            return None
        return principal

    async def _owner_executor(self, principal: McpPrincipal) -> ClientContractExecutor:
        """The principal's current executor, rebuilt once its authorized view changed."""

        key = "owner:" + principal.owner
        cached = self._executors.get(key)
        if cached is not None and not cached.invalidated:
            self._executors.move_to_end(key)
            return cached
        lock = self._creating.setdefault(key, anyio.Lock())
        async with lock:
            cached = self._executors.get(key)
            if cached is not None and not cached.invalidated:
                return cached
            owner = principal.owner
            executor = await self._factory(
                principal, lambda: dict(self._credentials.get(owner, {}))
            )
            self._remember(key, executor)
        # Waiters already hold the lock object; the table only serves new arrivals.
        self._creating.pop(key, None)
        return executor

    async def _session_executor(
        self, session_id: str, principal: McpPrincipal
    ) -> ClientContractExecutor:
        """A session keeps the executor it started with: no call runs on a changed view."""

        key = "session:" + session_id
        cached = self._executors.get(key)
        if cached is not None:
            self._executors.move_to_end(key)
            return cached
        executor = await self._owner_executor(principal)
        self._remember(key, executor)
        return executor

    def _remember(self, key: str, executor: ClientContractExecutor) -> None:
        self._executors[key] = executor
        self._executors.move_to_end(key)
        while len(self._executors) > self._max_executors:
            self._executors.popitem(last=False)

    async def _resolve(self, context: Any) -> ClientContractExecutor:
        request = getattr(context, "request", None)
        principal = getattr(request, "scope", {}).get(_PRINCIPAL_SCOPE_KEY) if request else None
        if not isinstance(principal, McpPrincipal):
            raise McpToolError("MCP_EXECUTION_FAILED", "No verified caller.", retryable=False)
        session_id = request.headers.get("mcp-session-id") if request is not None else None
        if session_id:
            return await self._session_executor(session_id, principal)
        return await self._owner_executor(principal)


def create_mcp_asgi_app(
    executor_factory: ExecutorFactory,
    authenticate: McpAuthenticator,
    *,
    name: str = SERVER_NAME,
    version: str = __version__,
    path: str = "/mcp",
    allowed_hosts: Iterable[str] | None = None,
    allowed_origins: Iterable[str] | None = None,
    protected_resource: ProtectedResource | None = None,
    max_sessions: int = DEFAULT_MAX_SESSIONS,
    session_idle_timeout: float = DEFAULT_SESSION_IDLE_TIMEOUT,
    max_request_body_size: int = DEFAULT_MAX_REQUEST_BODY_SIZE,
) -> McpAsgiApp:
    """A Streamable HTTP MCP app; see `McpAsgiApp`.

    *allowed_hosts* defaults to loopback names; *allowed_origins* to none
    (requests without ``Origin``, as MCP clients send, are always allowed).
    """

    return McpAsgiApp(
        executor_factory,
        authenticate,
        name=name,
        version=version,
        path=path,
        allowed_hosts=allowed_hosts,
        allowed_origins=allowed_origins,
        protected_resource=protected_resource,
        max_sessions=max_sessions,
        session_idle_timeout=session_idle_timeout,
        max_request_body_size=max_request_body_size,
    )
