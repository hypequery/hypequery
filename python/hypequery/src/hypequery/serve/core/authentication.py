"""Authenticate-before-body: one API's auth strategy and tenancy.

The strategy is either a header credential's authenticator, which receives the
credential and nothing else, or a context strategy, whose extractor reads the
host's own session from the request (`context_auth.py`).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import replace
from functools import partial
from typing import cast

from ...datasets.planner import TenantScope
from .auth import (
    Authenticator,
    CredentialTransport,
    InvalidCredential,
    Principal,
    RequestAuth,
    TenantResolver,
    credential_presented,
    cross_origin_refused,
    misconfigured,
    read_credential,
    unauthenticated,
)
from .context_auth import ContextStrategy
from .messages import ServeRequest
from .state import RequestState
from .utils.provider_call import call_provider
from .utils.same_origin import same_origin_allowed, trusted_origins
from .work import run_on_thread


class Authentication:
    """One API's authentication: its strategy and tenancy.

    It runs before any body is read. Results are kept per request and per
    `Authentication`, so an endpoint authenticated by one API is never handed
    another API's result.

    *authenticate* is a header credential's authenticator, read through
    *credentials*, or a `ContextStrategy`, which takes no *credentials*.
    *origins* are the CORS policy's origins, which a context strategy's
    same-origin check trusts.
    """

    __slots__ = ("authenticate", "context", "credentials", "resolve_tenant", "trusted")

    authenticate: Authenticator | ContextStrategy
    #: The context strategy, or None for a header credential.
    context: ContextStrategy | None
    #: The header credential's transport, or None for a context strategy.
    credentials: CredentialTransport | None

    def __init__(
        self,
        authenticate: Authenticator | ContextStrategy,
        credentials: CredentialTransport | None,
        resolve_tenant: TenantResolver,
        *,
        origins: Iterable[str] = (),
    ) -> None:
        if type(authenticate) is ContextStrategy:
            if credentials is not None:
                raise TypeError("a from_context strategy reads no credential header")
            self.context = authenticate
        else:
            if type(credentials) is not CredentialTransport:
                raise TypeError("a header authenticator requires a CredentialTransport")
            self.context = None
        self.authenticate = authenticate
        self.credentials = credentials
        self.resolve_tenant = resolve_tenant
        self.trusted = trusted_origins(tuple(origins))

    @property
    def vary(self) -> str:
        """The request header a response authenticated by this API varies on."""

        return "cookie" if self.credentials is None else self.credentials.header

    async def __call__(self, request: ServeRequest, state: RequestState) -> RequestAuth:
        cached = state.auths.get(self)
        if type(cached) is RequestAuth:
            return cached
        auth = await self._run(request, state)
        state.auths[self] = auth
        return auth

    async def _run(self, request: ServeRequest, state: RequestState) -> RequestAuth:
        if self.context is not None:
            principal = await self._from_context(self.context, request, state)
        else:
            principal = await self._from_credential(request, state)
        scope = await call_provider(self.resolve_tenant, principal, state.work)
        if scope is not None and (
            type(scope) is not TenantScope or scope.cross_tenant or len(scope.ids) != 1
        ):
            raise misconfigured()
        return RequestAuth(principal=principal, tenant=scope)

    async def _from_credential(self, request: ServeRequest, state: RequestState) -> Principal:
        # Both are set for every strategy but a context one.
        transport = cast(CredentialTransport, self.credentials)
        authenticate = cast(Authenticator, self.authenticate)
        presented = credential_presented(request.headers, transport)
        credential = read_credential(request.headers, transport)
        if credential is None:
            raise unauthenticated(transport, presented=presented)
        try:
            principal = await call_provider(authenticate, credential, state.work, rejectable=True)
        except InvalidCredential:
            raise unauthenticated(transport, presented=True) from None
        if principal is None:
            raise unauthenticated(transport, presented=True)
        if type(principal) is not Principal:
            raise misconfigured()
        return principal

    async def _from_context(
        self, strategy: ContextStrategy, request: ServeRequest, state: RequestState
    ) -> Principal:
        # Before the host's session is read: a forged request learns nothing,
        # and costs no session lookup.
        if strategy.same_origin and not same_origin_allowed(
            request.method, request.headers, self.trusted
        ):
            raise cross_origin_refused()
        runner = request.run_on_request_thread
        if runner is not None:
            # Whatever the extractor runs on the request's thread, through
            # this or through `request.run_on_request_thread` itself, holds
            # the request's production slot until it returns.
            runner = partial(run_on_thread, state.work, runner)
            request = replace(request, run_on_request_thread=runner)
        try:
            principal = await call_provider(
                strategy.extract, request, state.work, rejectable=True, thread=runner
            )
        except InvalidCredential:
            raise unauthenticated(None, presented=True) from None
        # Nobody signed in: TypeScript's "missing" credentials.
        if principal is None:
            raise unauthenticated(None, presented=False)
        if type(principal) is not Principal:
            raise misconfigured()
        return principal
