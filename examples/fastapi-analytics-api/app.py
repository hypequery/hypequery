"""FastAPI + hypequery: governed analytics endpoints and your own report routes.

Run:  uv sync && uv run uvicorn app:app --reload
Then: curl -s -X POST localhost:8000/auth/token -H 'content-type: application/json' \
          -d '{"email":"ada@quartz.example"}'
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from hypequery.datasets import tenant
from hypequery.serve import Credential, InvalidCredential, to_asgi_app
from pydantic import BaseModel

from analytics.api import api, client, executor, issue_token, verify_token
from analytics.datasets import events

DEMO_USERS: dict[str, dict[str, object]] = {
    "ada@quartz.example": {"tenant_id": 153, "name": "Ada", "tenant_name": "Quartz Metrics (enterprise)"},
    "grace@relay.example": {"tenant_id": 170, "name": "Grace", "tenant_name": "Relay Works (growth)"},
    "linus@helix.example": {"tenant_id": 146, "name": "Linus", "tenant_name": "Helix Analytics (starter)"},
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await executor.aclose()


app = FastAPI(title="Analytics API", lifespan=lifespan)
# POST /analytics/datasets/events/query, POST /analytics/datasets/subscriptions/query,
# GET /analytics/discovery: validated, tenant-scoped, served by hypequery.
app.mount("/analytics", to_asgi_app(api))


class TokenRequest(BaseModel):
    email: str


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/auth/demo-users")
async def demo_users() -> list[dict[str, object]]:
    return [{"email": email, "name": u["name"], "tenant_name": u["tenant_name"]} for email, u in DEMO_USERS.items()]


@app.post("/auth/token")
async def token(body: TokenRequest) -> dict[str, object]:
    user = DEMO_USERS.get(body.email)
    if user is None:
        raise HTTPException(status_code=401, detail="unknown user")
    return {
        "token": issue_token(body.email, tenant_id=str(user["tenant_id"]), roles=["viewer"]),
        "expires_in": 900,
    }


# --- Your own routes, same datasets, same tenant scoping --------------------------
async def current_tenant(authorization: Annotated[str | None, Header()] = None) -> str:
    """Your own auth dependency: trust the same analytics token hypequery does."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    try:
        principal = await verify_token(Credential("bearer", authorization.split(" ", 1)[1]))
    except InvalidCredential:
        principal = None
    if principal is None or principal.tenant_id is None:
        raise HTTPException(status_code=401, detail="invalid token")
    return principal.tenant_id


@app.get("/reports/top-paths")
async def top_paths(tenant_id: Annotated[str, Depends(current_tenant)], limit: int = 5) -> dict[str, object]:
    """A hand-written report: the busiest paths for the caller's tenant."""
    scoped = client.for_tenant(tenant(tenant_id))
    result = await scoped.execute(
        events,
        {
            "dimensions": ["path"],
            "measures": ["events", "unique_users"],
            "order_by": [{"field": "events", "direction": "desc"}],
            "limit": min(limit, 20),
        },
    )
    return {"tenant_id": tenant_id, "data": list(result.data)}
