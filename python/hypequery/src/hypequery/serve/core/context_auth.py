"""Context authentication: the host app's own login, TypeScript's `fromContext`.

A header-credential strategy hands the authenticator one opaque credential. A
context strategy instead hands the host's *extract* the whole `ServeRequest`,
so it can read the session the host framework already resolved from
``request.raw`` (Django's ``request.user``, Flask's ``session``). This is the
one place RFC 0009, as amended by decision 0023 §4, lets identity come from
request state: trusted host code reading the host's own session. hypequery
itself still derives nothing from the request, and the tenant still comes only
from the principal.

A session cookie is attached by the browser, not by the page, so a context
strategy is exposed to cross-site request forgery where a header credential
is not. With ``same_origin=True``, the default, the core refuses an unsafe
method unless the browser marks it same-origin, its ``Origin`` is the
request's own, or it comes from an origin the CORS policy names
(`utils/same_origin.py`); every adapter gets the check.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TypeAlias

from .auth import Principal
from .messages import ServeRequest

#: Reads the host's session from the request; returns the principal, or None
#: when nobody is signed in. Sync or async. A sync one runs on the request's
#: own thread under a sync host, and in the worker pool under an async one.
ContextExtractor: TypeAlias = Callable[
    [ServeRequest], Awaitable[Principal | None] | Principal | None
]


@dataclass(frozen=True, slots=True, eq=False)
class ContextStrategy:
    """An auth strategy that reads the host's session; see `from_context`."""

    extract: ContextExtractor
    same_origin: bool = True
    #: The session cookie's name, for the development OpenAPI document only.
    session_cookie: str = "session"

    def __post_init__(self) -> None:
        if not callable(self.extract):
            raise TypeError("from_context requires an extract callable")
        if type(self.same_origin) is not bool:
            raise TypeError("same_origin must be a boolean")
        if type(self.session_cookie) is not str or not self.session_cookie:
            raise TypeError("session_cookie must be a non-empty string")


def from_context(extract: ContextExtractor, *, same_origin: bool = True) -> ContextStrategy:
    """Authenticate with the host app's own login, for `create_api(auth=...)`.

    *extract* receives the `ServeRequest` and reads the host's session through
    ``request.raw``, the framework's own request. It returns a `Principal`, or
    None when the request is not signed in (answered 401); raising
    `InvalidCredential` is also a 401, and any other exception is
    authentication being unavailable (503). It may be sync or async.

    With *same_origin* (the default), unsafe methods are refused with 403
    unless ``Sec-Fetch-Site`` is ``same-origin`` or ``none``, or ``Origin`` is
    the request's own (its scheme and ``Host``) or in the API's
    ``HttpSecurity.cors.origins``. A production profile refuses
    ``same_origin=False``. `hypequery.contrib.django.django_user` and
    `hypequery.contrib.flask.flask_session` build *extract* for Django and
    Flask.
    """

    return ContextStrategy(extract, same_origin)
