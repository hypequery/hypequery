"""Run: python -m examples.flask_app (from python/hypequery).

Needs ``hypequery[flask]``. Seed examples/seed.sql; set CLICKHOUSE_URL
(or the CLICKHOUSE_* variables), HYPEQUERY_TENANT_A_TOKEN and
HYPEQUERY_TENANT_B_TOKEN. Then:

    curl -H "Authorization: Bearer $HYPEQUERY_TENANT_A_TOKEN" localhost:5001/revenue
"""

from __future__ import annotations

from typing import Any

from flask import Flask, abort, request

from hypequery.contrib.flask import Hypequery

from .utils.orders import organization_for

hq = Hypequery()


@hq.tenant_loader
def current_tenant() -> str | None:
    # In a real app: current_user.org_id if current_user.is_authenticated (Flask-Login).
    return organization_for(request.headers.get("Authorization"))


def create_app() -> Flask:
    app = Flask(__name__)
    # HYPEQUERY_URL is unset, so the connection comes from CLICKHOUSE_URL or CLICKHOUSE_*.
    app.config["HYPEQUERY_REGISTRY"] = "examples.utils.orders:registry"
    hq.init_app(app)

    @app.get("/revenue")
    def revenue() -> Any:
        """Revenue by country for the caller's organization only."""

        if current_tenant() is None:
            abort(401)
        result = hq.client.execute(
            "orders", {"dimensions": ["country"], "measures": ["revenue", "orderCount"]}
        )
        return {"data": list(result.data)}

    @app.get("/revenue/daily")
    async def revenue_by_day() -> Any:
        if current_tenant() is None:
            abort(401)
        result = await hq.async_client.execute("orders", {"measures": ["revenue"], "by": "day"})
        return {"data": list(result.data)}

    return app


if __name__ == "__main__":
    # 5001, not Flask's default 5000: macOS's AirPlay receiver listens on 5000.
    create_app().run(port=5001)
