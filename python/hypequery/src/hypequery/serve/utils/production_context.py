"""Trusted per-request production budgets, never decoded from client data."""

from __future__ import annotations

from fastapi import Request
from starlette.types import Scope

from ..production import ProductionProfile
from .scope_slot import ScopeSlot

_PRODUCTION_SLOT: ScopeSlot[ProductionProfile] = ScopeSlot(ProductionProfile)


def set_production_profile(scope: Scope, profile: ProductionProfile) -> None:
    _PRODUCTION_SLOT.set(scope, profile)


def production_profile(request: Request) -> ProductionProfile | None:
    return _PRODUCTION_SLOT.get(request.scope)
