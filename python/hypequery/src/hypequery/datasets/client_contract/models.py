"""Definition-only client endpoint metadata; no serving or execution imports."""

from __future__ import annotations

from dataclasses import dataclass

from ...protocol import ClientQueryLimits
from ..dataset import Dataset


@dataclass(frozen=True, slots=True)
class ClientQueryProfile:
    """Trusted export ceilings, validated when the contract is prepared.

    Hosts must intersect these with actual endpoint/process settings before
    advertising an HTTP endpoint. Defaults select a bounded client profile.
    """

    default_limit: int = 1000
    max_limit: int = 1000
    max_offset: int = 1_000_000
    max_dimensions: int = 100
    max_measures: int = 100
    max_predicates: int = 100
    max_order_by: int = 100
    max_filter_values: int = 10000
    default_timezone: str = "UTC"

    def limits(self, dataset: Dataset) -> ClientQueryLimits:
        """Intersect trusted profile and definition ceilings, never widen them."""
        limits = dataset.limits
        maximum = min(
            self.max_limit,
            limits.max_result_size
            if limits and limits.max_result_size is not None
            else self.max_limit,
        )
        return {
            "defaultLimit": min(self.default_limit, maximum),
            "maxLimit": maximum,
            "maxOffset": self.max_offset,
            "maxDimensions": min(
                self.max_dimensions,
                limits.max_dimensions
                if limits and limits.max_dimensions is not None
                else self.max_dimensions,
            ),
            "maxMeasures": min(
                self.max_measures,
                limits.max_measures
                if limits and limits.max_measures is not None
                else self.max_measures,
            ),
            "maxPredicates": min(
                self.max_predicates,
                limits.max_filters
                if limits and limits.max_filters is not None
                else self.max_predicates,
            ),
            "maxOrderBy": self.max_order_by,
            "maxFilterValues": self.max_filter_values,
        }


@dataclass(frozen=True, slots=True)
class ClientEndpointDefinition:
    """One logical endpoint to export, with an explicit trusted client profile.

    No route is registered and no client/executor is constructed. For metrics,
    measure names the local measure and name is the public metric/output alias.
    The host owns the final route and must enforce the advertised strict profile.
    *related* names the relationships whose fields the endpoint exposes; None
    exposes every queryable relationship.
    """

    dataset: Dataset
    path: str
    profile: ClientQueryProfile
    measure: str | None = None
    name: str | None = None
    related: frozenset[str] | None = None
