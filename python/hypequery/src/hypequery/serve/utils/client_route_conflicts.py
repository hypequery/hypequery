"""Conservative ambiguity checks for public static client route projections."""

from collections.abc import Sequence

from fastapi.routing import RouteContext
from starlette.routing import Host, Mount


def client_route_conflicts(route: RouteContext, routes: Sequence[RouteContext]) -> bool:
    if route.path is None:
        return True
    for other in routes:
        if other is route:
            continue
        if isinstance(other.original_route, Host):
            return True
        if isinstance(other.original_route, Mount):
            prefix = (other.path or "").rstrip("/")
            pattern = getattr(other, "path_regex", None)
            if (
                route.path == prefix
                or route.path.startswith(prefix + "/")
                or (pattern is not None and pattern.fullmatch(route.path))
            ):
                return True
        if "POST" in (other.methods or set()):
            pattern = getattr(other, "path_regex", None)
            if pattern is None or pattern.fullmatch(route.path):
                return True
    return False
