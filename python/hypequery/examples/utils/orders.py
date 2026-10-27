"""The orders dataset and a stand-in login shared by the framework examples.

The framework examples resolve the tenant from a bearer token so they run
without a user database. A real Django or Flask app reads it from the logged-in
user instead (``request.user`` or Flask-Login's ``current_user``); the shape of
the integration is the same.
"""

from __future__ import annotations

import secrets

from hypequery.datasets import create_dataset_registry, dataset, dimension, measure
from hypequery.serve import Principal

from .config import required_environment

orders = dataset(
    "orders",
    source="example_orders",
    tenant_key="org_id",
    time_key="created_at",
    dimensions={"country": dimension.string(), "created_at": dimension.timestamp()},
    measures={"revenue": measure.sum("amount"), "orderCount": measure.count("id")},
)
registry = create_dataset_registry(orders)


def tenant_tokens() -> dict[str, str]:
    """Server-side token -> organization table, read from the environment."""

    token_a = required_environment("HYPEQUERY_TENANT_A_TOKEN")
    token_b = required_environment("HYPEQUERY_TENANT_B_TOKEN")
    if token_a == token_b:
        raise ValueError("The tenant tokens must be distinct")
    return {token_a: "a", token_b: "b"}


def organization_for(authorization: str | None) -> str | None:
    """The organization an ``Authorization: Bearer`` header belongs to, if any."""

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    for known, organization in tenant_tokens().items():
        if secrets.compare_digest(token, known):
            return organization
    return None


def principals() -> dict[str, Principal]:
    """The same table as Serve principals, for the mounted HTTP endpoints."""

    return {
        token: Principal(
            subject=f"user-{organization}",
            tenant_id=organization,
            scopes=frozenset({"analytics:read"}),
        )
        for token, organization in tenant_tokens().items()
    }
