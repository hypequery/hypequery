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
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, Iterator, Mapping
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

import mcp_types as types
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
from mcp.server.auth.provider import AccessToken
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.shared.exceptions import MCPError
from starlette.types import Message, Receive, Scope, Send

from .. import __version__
from .errors import McpToolError, classify_mcp_tool_error
from .executor import ClientContractExecutor
from .http_auth import McpAuthenticator, McpAuthError, McpPrincipal
from .utils.http_guards import (
    ALLOWED_REQUEST_HEADERS,
    ALLOWED_REQUEST_METHODS,
    EXPOSED_RESPONSE_HEADERS,
    PREFLIGHT_MAX_AGE_SECONDS,
    host_allowed,
    normalize_allowed_hosts,
    normalize_allowed_origins,
    origin_allowed,
)
from .utils.oauth import BearerError, ProtectedResource, bearer_challenge

SERVER_NAME = "hypequery-mcp-server"

#: Where the HTTP app leaves the verified principal and this request's forwarded
#: credential headers for the tool handlers. Both belong to one HTTP request.
_PRINCIPAL_SCOPE_KEY = "hypequery.mcp.principal"
_CREDENTIALS_SCOPE_KEY = "hypequery.mcp.credentials"

#: The forwarded credential headers of the request being served, and nothing else.
CredentialSource = Callable[[], Mapping[str, str]]
#: Builds the executor for a new session; *credentials* returns the headers of the
#: request that is being served right now, never another session's.
ExecutorFactory = Callable[[McpPrincipal, CredentialSource], Awaitable[ClientContractExecutor]]


@dataclass(frozen=True, slots=True)
class _Resolved:
    """An executor and how to run it as the request being served."""

    executor: ClientContractExecutor
    #: A context manager that makes this request's credentials the ones the
    #: executor's backend sends; a no-op for stdio, which has no per-call caller.
    bind: Callable[[], contextlib.AbstractContextManager[None]]


_Resolver = Callable[[Any], Awaitable[_Resolved]]


def _protocol_error(error: Exception) -> MCPError:
    """A JSON-RPC error carrying only the classified, public details of *error*.

    Anything but an `McpToolError` becomes the generic failure, so a backend's
    or driver's message never reaches the agent.
    """

    details = classify_mcp_tool_error(error)
    return MCPError(types.INTERNAL_ERROR, details["message"], data={"error": dict(details)})


def _server(resolve: _Resolver, *, name: str, version: str) -> Server[Any]:
    async def list_tools(
        context: Any, _params: types.PaginatedRequestParams | None
    ) -> types.ListToolsResult:
        try:
            resolved = await resolve(context)
            with resolved.bind():
                return types.ListToolsResult.model_validate(await resolved.executor.list_tools())
        except Exception as error:
            raise _protocol_error(error) from None

    async def call_tool(context: Any, params: types.CallToolRequestParams) -> types.CallToolResult:
        try:
            resolved = await resolve(context)
        except Exception as error:
            raise _protocol_error(error) from None
        with resolved.bind():
            return types.CallToolResult.model_validate(
                await resolved.executor.call_tool(params.name, params.arguments)
            )

    async def list_prompts(
        context: Any, _params: types.PaginatedRequestParams | None
    ) -> types.ListPromptsResult:
        try:
            resolved = await resolve(context)
            with resolved.bind():
                return types.ListPromptsResult.model_validate(
                    await resolved.executor.list_prompts()
                )
        except Exception as error:
            raise _protocol_error(error) from None

    async def get_prompt(
        context: Any, params: types.GetPromptRequestParams
    ) -> types.GetPromptResult:
        try:
            resolved = await resolve(context)
            with resolved.bind():
                return types.GetPromptResult.model_validate(
                    await resolved.executor.get_prompt(params.name, params.arguments)
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

    resolved = _Resolved(executor, contextlib.nullcontext)

    async def resolve(_context: Any) -> _Resolved:
        return resolved

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
    413: b"Payload Too Large",
    421: b"Misdirected Request",
    500: b"Internal Server Error",
    503: b"Service Unavailable",
}


def _cors_headers(origin: str) -> list[tuple[bytes, bytes]]:
    """What a browser needs on any response to an allowed *origin*."""

    return [
        (b"access-control-allow-origin", origin.encode("latin-1")),
        (b"access-control-expose-headers", ", ".join(EXPOSED_RESPONSE_HEADERS).encode()),
        (b"vary", b"Origin"),
    ]


def _with_cors(send: Send, origin: str) -> Send:
    """*send*, adding CORS headers to the response head so the page may read it."""

    async def wrapped(message: Message) -> None:
        if message["type"] == "http.response.start":
            message = {**message, "headers": [*message.get("headers", ()), *_cors_headers(origin)]}
        await send(message)

    return wrapped


class _BodyTooLargeError(Exception):
    """A request body passed the configured ceiling."""


class _ClientGoneError(Exception):
    """The caller disconnected before sending its whole body."""


async def _read_body(receive: Receive, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            raise _ClientGoneError
        chunk = message.get("body", b"")
        total += len(chunk)
        if total > limit:
            raise _BodyTooLargeError
        chunks.append(chunk)
        if not message.get("more_body", False):
            return b"".join(chunks)


def _replay(body: bytes, receive: Receive) -> Receive:
    """*receive* after *body* was already read from it: the body again, then the rest."""

    replayed = False

    async def replay() -> Message:
        nonlocal replayed
        if not replayed:
            replayed = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    return replay


def _is_initialize(body: bytes) -> bool:
    """Whether *body* is, or batches, a JSON-RPC ``initialize`` request."""

    try:
        parsed = json.loads(body)
    except ValueError:
        return False
    messages = parsed if isinstance(parsed, list) else [parsed]
    return any(isinstance(m, dict) and m.get("method") == "initialize" for m in messages)


@dataclass(slots=True)
class _Session:
    """What the app holds for one open MCP session: its caller and its executor."""

    owner: str
    executor: ClientContractExecutor
    #: Requests in flight, including an open SSE stream: such a session is never idle.
    active: int = 0
    last_used: float = field(default_factory=time.monotonic)


class McpAsgiApp:
    """A self-hosted Streamable HTTP MCP server, as an ASGI app.

    Every request is checked in order: ``Host`` (DNS rebinding), route,
    ``Origin`` (a browser's preflight is answered here, before any
    credential), credential, then session ownership, exactly as TypeScript's
    `createMCPHttpHandler`. Each MCP session belongs to the principal that
    opened it: another principal using its id is answered 404, like an unknown
    session.

    A session owns one executor, built by *executor_factory* when the SDK admits
    it and dropped when the session is deleted, idle or the app stops. A request
    with no session (the sessionless protocol) gets an executor of its own. Each
    request's credentials are bound only while that request is served, so an
    executor never sends another client's token, even for the same principal.

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
        self._max_sessions = max_sessions
        self._max_body = max_request_body_size
        self._idle_timeout = float(session_idle_timeout)
        # A credential read from another header (an API key) must be sendable by a page too.
        self._allowed_request_headers = tuple(
            dict.fromkeys([*ALLOWED_REQUEST_HEADERS, *authenticate.credential_headers])
        )
        self._sessions: dict[str, _Session] = {}
        self._credentials: ContextVar[Mapping[str, str]] = ContextVar("hypequery_mcp_credentials")
        self._manager = StreamableHTTPSessionManager(
            _server(self._resolve, name=name, version=version),
            session_idle_timeout=session_idle_timeout,
            max_request_body_size=max_request_body_size,
            max_sessions=max_sessions,
        )

    @contextlib.asynccontextmanager
    async def run(self) -> AsyncIterator[None]:
        """Run the session manager; required before the app serves a request."""

        try:
            async with self._manager.run():
                yield
        finally:
            self._sessions.clear()

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

    # --- Request pipeline ---------------------------------------------------

    async def _http(self, scope: Scope, receive: Receive, send: Send) -> None:
        headers, duplicated = _request_headers(scope)
        origin = headers.get("origin")
        if origin is not None and origin in self._origins:
            # Every answer to an allowed page, refusals included, is readable by it.
            send = _with_cors(send, origin)
        if not await self._admit(scope, headers, send):
            return
        principal = await self._principal(headers, duplicated, send)
        if principal is None:
            return
        forwarded = self._authenticate.credential_headers
        credentials = {name: headers[name] for name in forwarded if name in headers}
        user = AuthenticatedUser(
            AccessToken(
                token=principal.owner, client_id=principal.owner, scopes=sorted(principal.scopes)
            )
        )
        scope = {
            **scope,
            "user": user,
            _PRINCIPAL_SCOPE_KEY: principal,
            _CREDENTIALS_SCOPE_KEY: credentials,
        }
        self._sweep()
        session_id = headers.get("mcp-session-id")
        if session_id is None:
            await self._open(scope, receive, send, principal, credentials)
        else:
            await self._continue(scope, receive, send, session_id, principal)

    async def _admit(self, scope: Scope, headers: Mapping[str, str], send: Send) -> bool:
        """Steps 1-3: Host, route (answering metadata and preflights itself) and Origin."""

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

        # 3. Browser pages may call only from listed origins. A preflight carries no
        # credential, so it is answered here or it could never succeed.
        origin = headers.get("origin")
        if not origin_allowed(origin, self._origins):
            await self._refuse(send, 403)
            return False
        if scope["method"] == "OPTIONS":
            await self._preflight(send, origin)
            return False
        return True

    async def _preflight(self, send: Send, origin: str | None) -> None:
        if origin is None:
            await self._refuse(send, 405, [("allow", ", ".join(ALLOWED_REQUEST_METHODS))])
            return
        await _respond(
            send,
            204,
            b"",
            headers=[
                ("access-control-allow-methods", ", ".join(ALLOWED_REQUEST_METHODS)),
                ("access-control-allow-headers", ", ".join(self._allowed_request_headers)),
                ("access-control-max-age", str(PREFLIGHT_MAX_AGE_SECONDS)),
            ],
        )

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

    # --- Sessions -----------------------------------------------------------

    async def _continue(
        self, scope: Scope, receive: Receive, send: Send, session_id: str, principal: McpPrincipal
    ) -> None:
        """Step 5 for a request naming a session: the SDK answers for ownership."""

        session = self._sessions.get(session_id)
        if session is None or session.owner != principal.owner:
            # Unknown, expired or someone else's: the SDK answers 404 for each.
            await self._manager.handle_request(scope, receive, send)
            return
        session.active += 1
        try:
            await self._manager.handle_request(scope, receive, send)
        finally:
            session.active -= 1
            session.last_used = time.monotonic()
            if scope["method"] == "DELETE":
                self._sessions.pop(session_id, None)

    async def _open(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        principal: McpPrincipal,
        credentials: Mapping[str, str],
    ) -> None:
        """A request without a session: only a valid ``initialize`` may open one."""

        if scope["method"] != "POST":
            await self._manager.handle_request(scope, receive, send)
            return
        try:
            body = await _read_body(receive, self._max_body)
        except _ClientGoneError:
            return
        except _BodyTooLargeError:
            await self._refuse(send, 413)
            return
        replay = _replay(body, receive)
        if not _is_initialize(body):
            # The SDK refuses it; nothing is built for a request that cannot open a session.
            await self._manager.handle_request(scope, replay, send)
            return
        if len(self._sessions) >= self._max_sessions:
            await self._refuse(send, 503)
            return
        try:
            with self._bind(credentials):
                executor = await self._factory(principal, self._credential_source)
        except Exception:
            # Executor errors may name backends or credentials; none reach the client.
            await self._refuse(send, 503)
            return
        await self._manager.handle_request(
            scope, replay, self._register_on_admission(send, principal, executor)
        )

    def _register_on_admission(
        self, send: Send, principal: McpPrincipal, executor: ClientContractExecutor
    ) -> Send:
        """Keep *executor* only if the SDK admits the session, under the id it chose."""

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start" and message["status"] == 200:
                for name, value in message.get("headers", ()):
                    if name.lower() == b"mcp-session-id":
                        self._sessions[value.decode("latin-1")] = _Session(
                            principal.owner, executor
                        )
            await send(message)

        return wrapped

    def _sweep(self) -> None:
        """Drop sessions the SDK has expired: idle for its timeout, with nothing in flight."""

        cutoff = time.monotonic() - self._idle_timeout
        for session_id in [
            sid for sid, s in self._sessions.items() if s.active == 0 and s.last_used < cutoff
        ]:
            del self._sessions[session_id]

    # --- Credentials --------------------------------------------------------

    @contextlib.contextmanager
    def _bind(self, credentials: Mapping[str, str]) -> Iterator[None]:
        token = self._credentials.set(credentials)
        try:
            yield
        finally:
            self._credentials.reset(token)

    def _credential_source(self) -> Mapping[str, str]:
        """The credentials of the request being served; none outside one, so a call fails closed."""

        return dict(self._credentials.get({}))

    async def _resolve(self, context: Any) -> _Resolved:
        request = getattr(context, "request", None)
        scope = getattr(request, "scope", None) or {}
        principal = scope.get(_PRINCIPAL_SCOPE_KEY)
        if not isinstance(principal, McpPrincipal):
            raise McpToolError("MCP_EXECUTION_FAILED", "No verified caller.", retryable=False)
        session_id = request.headers.get("mcp-session-id") if request is not None else None
        credentials = scope.get(_CREDENTIALS_SCOPE_KEY, {})
        if not session_id:
            # The 2026-era protocol has no session: each request stands alone, so it gets
            # its own executor, built with its own credentials and kept by no one.
            with self._bind(credentials):
                executor = await self._factory(principal, self._credential_source)
            return _Resolved(executor, lambda: self._bind(credentials))
        session = self._sessions.get(session_id)
        if session is None or session.owner != principal.owner:
            # Never rebuilt silently: a session continues on the executor it started with.
            raise McpToolError(
                "MCP_EXECUTION_FAILED", "The MCP session ended; reconnect.", retryable=False
            )
        return _Resolved(session.executor, lambda: self._bind(credentials))


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
