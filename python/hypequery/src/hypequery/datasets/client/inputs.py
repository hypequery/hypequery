"""Turn what a caller passes a client into what the planner accepts."""

from __future__ import annotations

from collections.abc import Mapping

from pydantic import ValidationError

from ..dataset import Dataset
from ..planner import CompiledQueryError, DatasetQuery
from ..registry import DatasetRegistry

QueryInput = DatasetQuery | Mapping[str, object] | None
DatasetTarget = Dataset | str


def resolve_dataset(target: DatasetTarget, registry: DatasetRegistry | None) -> Dataset:
    """The dataset *target* names, checked against the client's registry.

    A dataset object is accepted when the registry either lacks its name or
    holds an equal definition. A different definition under the same name
    would plan joins against one model and select from another, so it is a
    programming error rather than something to resolve quietly.
    """

    if isinstance(target, Dataset):
        registered = registry.get(target.name) if registry is not None else None
        if registered is not None and registered != target:
            raise ValueError(
                f'Dataset "{target.name}" differs from the dataset registered under that name.'
            )
        return target
    if type(target) is not str:
        raise TypeError("a dataset target must be a Dataset or a registered dataset name")
    dataset = registry.get(target) if registry is not None else None
    if dataset is None:
        # The name is caller input, so it is not echoed back.
        raise CompiledQueryError("not-found", "The dataset is not registered with this client.")
    return dataset


def validation_messages(error: ValidationError) -> tuple[str, ...]:
    """Field locations and reasons, never the rejected input itself."""

    messages: list[str] = []
    for detail in error.errors(include_input=False, include_url=False):
        location = ".".join(str(part) for part in detail["loc"])
        messages.append(f"{location}: {detail['msg']}" if location else detail["msg"])
    return tuple(messages)


def coerce_query(query: QueryInput) -> DatasetQuery:
    """Validate a mapping into a `DatasetQuery`; pass a model through unchanged."""

    if query is None:
        return DatasetQuery()
    if isinstance(query, DatasetQuery):
        return query
    if not isinstance(query, Mapping):
        raise TypeError("a dataset query must be a DatasetQuery or a mapping")
    try:
        return DatasetQuery.model_validate(dict(query))
    except ValidationError as exc:
        raise CompiledQueryError(
            "input-invalid", "Invalid dataset query: " + "; ".join(validation_messages(exc))
        ) from None
