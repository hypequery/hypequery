"""What the core keeps for one request while it is being served."""

from __future__ import annotations

from dataclasses import dataclass, field

from .auth import RequestAuth
from .production import ProductionProfile
from .work import RequestWork


@dataclass(slots=True, eq=False)
class RequestState:
    """Per-request state, created by `Api.handle` or by the adapter that dispatches.

    It is never built from request input: *request_id* is the server's own,
    *production* is the host's profile, and *auths* holds only results of the
    core's own authentication, keyed by the `Authentication` that produced them.
    """

    request_id: str
    production: ProductionProfile | None = None
    work: RequestWork = field(default_factory=RequestWork)
    auths: dict[object, RequestAuth] = field(default_factory=dict)

    def authenticated(self) -> RequestAuth | None:
        """The `RequestAuth` established for this request, if any."""

        for auth in self.auths.values():
            if type(auth) is RequestAuth:
                return auth
        return None
