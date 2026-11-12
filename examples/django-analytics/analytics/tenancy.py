"""HYPEQUERY["TENANT"]: which ClickHouse tenant a request may read.

It runs once per request, after authentication, the first time a view touches
request.analytics. None means no tenant, and tenant-keyed datasets then refuse
to run, so an anonymous user or one without an organization reads nothing.
"""

from django.http import HttpRequest


def tenant_for_request(request: HttpRequest) -> str | None:
    user = request.user
    if not user.is_authenticated or not hasattr(user, "membership"):
        return None
    return str(user.membership.organization.clickhouse_tenant_id)
