"""Trusted per-request production budgets, never decoded from client data."""

from __future__ import annotations

from collections.abc import MutableMapping
from typing import Any, cast

from fastapi import Request
from starlette.types import Scope

from ..production import ProductionProfile

PRODUCTION_SCOPE_KEY = object()


def set_production_profile(scope: Scope, profile: ProductionProfile) -> None:
    cast(MutableMapping[object, Any], scope)[PRODUCTION_SCOPE_KEY] = profile


def production_profile(request: Request) -> ProductionProfile | None:
    value = cast(MutableMapping[object, Any], request.scope).get(PRODUCTION_SCOPE_KEY)
    return value if type(value) is ProductionProfile else None
