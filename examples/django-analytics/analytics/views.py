"""JSON views over the events dataset. request.analytics is already bound to
the signed-in user's tenant, so no view names a tenant or writes SQL."""

from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET

from analytics.datasets import events
from analytics.utils import member_required, period_filter

GRAINS = {"day", "week", "month"}
BREAKDOWNS = {"event_type", "device", "path"}


@require_GET
def health(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"status": "ok"})


@require_GET
@member_required
def overview(request: HttpRequest) -> JsonResponse:
    """Headline numbers, next to app data from the ORM."""
    org = request.user.membership.organization
    window = period_filter(request)
    result = request.analytics.execute(
        events, {"measures": ["events", "active_users", "error_rate", "p95_latency_ms"], "filters": [window]}
    )
    return JsonResponse({"organization": org.name, "plan": org.plan, "period": window["value"], "data": result.data[0]})


@require_GET
@member_required
def timeseries(request: HttpRequest) -> JsonResponse:
    grain = request.GET.get("by", "day")
    if grain not in GRAINS:
        return JsonResponse({"error": f"by must be one of {sorted(GRAINS)}"}, status=400)
    result = request.analytics.execute(
        events, {"measures": ["events", "active_users"], "by": grain, "filters": [period_filter(request)]}
    )
    return JsonResponse({"by": grain, "data": list(result.data)})


@require_GET
@member_required
def breakdown(request: HttpRequest, dimension: str) -> JsonResponse:
    if dimension not in BREAKDOWNS:
        return JsonResponse({"error": f"dimension must be one of {sorted(BREAKDOWNS)}"}, status=404)
    result = request.analytics.execute(
        events,
        {
            "dimensions": [dimension],
            "measures": ["events", "error_rate"],
            "filters": [period_filter(request)],
            "order_by": [{"field": "events", "direction": "desc"}],
            "limit": min(int(request.GET.get("limit", 10)), 50),
        },
    )
    return JsonResponse({"dimension": dimension, "data": list(result.data)})
