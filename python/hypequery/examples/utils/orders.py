"""The orders dataset and a stand-in login shared by the framework examples.

The framework examples' stand-in login: each organization signs in with its
tenant token, and its bearer callers present the same token. A real Django or
Flask app signs users in with its own login and reads the organization from
the user (``request.user`` or Flask-Login's ``current_user``); the shape of the
integration is the same.
"""

from __future__ import annotations

import secrets

from hypequery.datasets import create_dataset_registry, dataset, dimension, measure

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
#: The example's organizations; each signs in with its tenant token.
ORGANIZATIONS = ("a", "b")


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
    return organization_for_token(token)


def organization_for_token(token: str) -> str | None:
    """The organization a bearer token belongs to, if any."""

    for known, organization in tenant_tokens().items():
        if secrets.compare_digest(token, known):
            return organization
    return None
