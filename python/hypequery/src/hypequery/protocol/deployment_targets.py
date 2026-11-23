"""Deployment-target acceptance (RFC 0030).

Mirrors ``@hypequery/protocol``: the contract 3 feature registry, derived from
a contract dataset, and a target's ``accepts`` advertisement. Both pass the
shared ``specs/security-protocol/drafts/target-acceptance-v1`` vectors.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, TypeAlias, cast

from .deployment_primitives import APPROXIMATE_AGGREGATIONS, SUB_DAY_GRAINS
from .errors import deployment_error
from .schema_models import UNSET

ProtocolContract3Feature: TypeAlias = Literal[
    "segments",
    "windowMeasures",
    "shiftMeasures",
    "approxCountDistinct",
    "subDayDefaultGrain",
    "alternateTimeFields",
]

#: Registry order, which every message and fixture follows.
PROTOCOL_CONTRACT_3_FEATURES: tuple[ProtocolContract3Feature, ...] = (
    "segments",
    "windowMeasures",
    "shiftMeasures",
    "approxCountDistinct",
    "subDayDefaultGrain",
    "alternateTimeFields",
)

#: What a target that advertises nothing accepts; each absent member defaults on its own.
DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS: Mapping[str, tuple[int, ...]] = {
    "deploymentContract": (2,),
    "semanticInvocation": (1,),
    "bundle": (1, 2),
}

_MAX_VERSIONS = 64


def contract_3_features(dataset: Mapping[str, object]) -> list[ProtocolContract3Feature]:
    """The contract 3 features a contract dataset uses, in registry order.

    Mirrors TypeScript's ``datasetContract3Features``. A contract 2 dataset
    uses none. The ``allowedFilters`` rename alone never forces contract 3.
    """

    measures = cast(list[Mapping[str, object]], dataset.get("measures") or [])
    defaults = cast(Mapping[str, object], dataset.get("defaults") or {})
    used: dict[ProtocolContract3Feature, bool] = {
        "segments": bool(dataset.get("segments")),
        "windowMeasures": any(item.get("kind") == "window" for item in measures),
        "shiftMeasures": any(item.get("kind") == "shift" for item in measures),
        "approxCountDistinct": any(
            item.get("aggregation") in APPROXIMATE_AGGREGATIONS for item in measures
        ),
        "subDayDefaultGrain": defaults.get("timeGrain") in SUB_DAY_GRAINS,
        "alternateTimeFields": bool(dataset.get("alternateTimeFields")),
    }
    return [feature for feature in PROTOCOL_CONTRACT_3_FEATURES if used[feature]]


def _versions(value: object, path: str) -> tuple[int, ...]:
    if not isinstance(value, list):
        deployment_error("HQ_DEPLOYMENT_TYPE", path)
    if not value or len(value) > _MAX_VERSIONS:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)
    result: list[int] = []
    for index, item in enumerate(value):
        item_path = f"{path}[{index}]"
        # ``bool`` is an ``int`` subclass; JSON ``true`` is not a version.
        if isinstance(item, bool) or not isinstance(item, int | float):
            deployment_error("HQ_DEPLOYMENT_TYPE", item_path)
        if not float(item).is_integer() or item < 1 or item > 2**53 - 1:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", item_path)
        version = int(item)
        if result and version <= result[-1]:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", item_path)
        result.append(version)
    return tuple(result)


def validate_protocol_deployment_target_accepts(
    value: object = UNSET,
) -> dict[str, tuple[int, ...]]:
    """Validate a target's ``accepts`` advertisement and fill absent members.

    ``UNSET`` (no advertisement) is the default advertisement. Unknown members
    are ignored. Each present member must be a non-empty, ascending list of
    distinct positive safe integers; anything else raises
    ``ProtocolDeploymentError`` at its path.
    """

    if value is UNSET:
        return dict(DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS)
    if not isinstance(value, dict):
        deployment_error("HQ_DEPLOYMENT_TYPE", "$")
    result: dict[str, tuple[int, ...]] = {}
    for member, default in DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS.items():
        result[member] = _versions(value[member], f"$.{member}") if member in value else default
    return result
