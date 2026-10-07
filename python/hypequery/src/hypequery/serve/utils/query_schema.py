"""Per-endpoint allowed-grain schemas, without changing shared wire names."""

from __future__ import annotations

from pydantic import BaseModel, Field, StrictStr, create_model, field_validator

from ...datasets.dataset import Dataset
from ..models import MetricRequest, QueryRequest


def endpoint_query_model(dataset: Dataset, *, metric: bool) -> type[BaseModel]:
    base = MetricRequest if metric else QueryRequest
    if dataset.time_grains is None:
        return base
    grains = dataset.time_grains

    def validate_grain(grain: str | None) -> str | None:
        if grain is not None and grain not in grains:
            raise ValueError("The dataset does not support the requested time grain.")
        return grain

    return create_model(
        ("MetricQuery_" if metric else "DatasetQuery_") + dataset.name,
        __base__=base,
        __validators__={"_allowed_grain": field_validator("by")(validate_grain)},
        by=(StrictStr | None, Field(default=None, json_schema_extra={"enum": [*grains, None]})),
    )
