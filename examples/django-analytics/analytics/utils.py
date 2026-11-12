"""Request helpers shared by the views."""

from datetime import date, timedelta
from functools import wraps

from django.core.exceptions import BadRequest
from django.http import HttpRequest, JsonResponse

# The seed's last month of events; pass ?from=&to= (YYYY-MM-DD) for another window.
DEFAULT_TO = date(2026, 10, 31)
DEFAULT_DAYS = 30


def member_required(view):
    """401 for anonymous callers, 403 for users outside every organization (JSON, no redirect)."""

    @wraps(view)
    def wrapper(request: HttpRequest, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "sign in first"}, status=401)
        if not hasattr(request.user, "membership"):
            return JsonResponse({"error": "no organization"}, status=403)
        return view(request, *args, **kwargs)

    return wrapper


def period_filter(request: HttpRequest) -> dict:
    """A between filter on occurred_at from ?from=&to=, inclusive of both days."""
    try:
        end = date.fromisoformat(request.GET["to"]) if "to" in request.GET else DEFAULT_TO
        start = date.fromisoformat(request.GET["from"]) if "from" in request.GET else end - timedelta(days=DEFAULT_DAYS - 1)
    except ValueError as exc:
        raise BadRequest("from and to must be YYYY-MM-DD") from exc  # Django answers 400
    return {"field": "occurred_at", "operator": "between", "value": [f"{start} 00:00:00", f"{end} 23:59:59"]}
