"""Serve hypequery's HTTP endpoints from a Django ASGI process.

In ``asgi.py``::

    from django.core.asgi import get_asgi_application
    from hypequery.contrib.django.asgi import mount_serve

    django_app = get_asgi_application()
    from analytics.serve import serve_app  # after Django is set up

    application = mount_serve(django_app, serve_app, prefix="/analytics")
"""

from __future__ import annotations

from ..utils.asgi_mount import ASGIApp, mount_asgi


def mount_serve(django_app: ASGIApp, serve_app: ASGIApp, *, prefix: str = "/analytics") -> ASGIApp:
    """One ASGI app: *prefix* and below go to *serve_app*, the rest to Django.

    Lifespan events go to *serve_app* only: Django's ASGI handler refuses them.
    *serve_app* keeps its own authentication; Serve reads credentials from a
    header and never from Django's session cookie.
    """

    return mount_asgi(django_app, serve_app, prefix=prefix, lifespan="mounted")
