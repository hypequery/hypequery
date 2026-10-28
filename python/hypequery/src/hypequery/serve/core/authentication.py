"""Authenticate-before-body: one API's credential transport, authenticator and tenancy."""

from __future__ import annotations

from ...datasets.planner import TenantScope
from .auth import (
    Authenticator,
    CredentialTransport,
    InvalidCredential,
    Principal,
    RequestAuth,
    TenantResolver,
    credential_presented,
    misconfigured,
    read_credential,
    unauthenticated,
)
from .messages import ServeRequest
from .state import RequestState
from .utils.provider_call import call_provider


class Authentication:
    """One API's authentication: credential transport, authenticator, tenancy.

    It runs before any body is read. Results are kept per request and per
    `Authentication`, so an endpoint authenticated by one API is never handed
    another API's result.
    """

    __slots__ = ("authenticate", "credentials", "resolve_tenant")

    def __init__(
        self,
        authenticate: Authenticator,
        credentials: CredentialTransport,
        resolve_tenant: TenantResolver,
    ) -> None:
        self.authenticate = authenticate
        self.credentials = credentials
        self.resolve_tenant = resolve_tenant

    async def __call__(self, request: ServeRequest, state: RequestState) -> RequestAuth:
        cached = state.auths.get(self)
        if type(cached) is RequestAuth:
            return cached
        auth = await self._run(request, state)
        state.auths[self] = auth
        return auth

    async def _run(self, request: ServeRequest, state: RequestState) -> RequestAuth:
        presented = credential_presented(request.headers, self.credentials)
        credential = read_credential(request.headers, self.credentials)
        if credential is None:
            raise unauthenticated(self.credentials, presented=presented)
        try:
            principal = await call_provider(
                self.authenticate, credential, state.work, rejectable=True
            )
        except InvalidCredential:
            raise unauthenticated(self.credentials, presented=True) from None
        if principal is None:
            raise unauthenticated(self.credentials, presented=True)
        if type(principal) is not Principal:
            raise misconfigured()
        scope = await call_provider(self.resolve_tenant, principal, state.work)
        if scope is not None and (
            type(scope) is not TenantScope or scope.cross_tenant or len(scope.ids) != 1
        ):
            raise misconfigured()
        return RequestAuth(principal=principal, tenant=scope)
