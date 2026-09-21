"""Runtime registry of defined datasets.

Serving and semantic clients discover datasets through a registry at startup.
It is also how a relationship's target is resolved: a Python relationship
stores only its target's name, so the registry — not a stored callback — turns
that name back into a dataset.
"""

from __future__ import annotations

from .dataset import Dataset


class DatasetRegistry:
    """A name-keyed collection of datasets, unique by dataset name."""

    __slots__ = ("_datasets",)

    def __init__(self) -> None:
        self._datasets: dict[str, Dataset] = {}

    def register(self, dataset: Dataset) -> None:
        """Add *dataset*, rejecting a name that is already registered."""

        if dataset.name in self._datasets:
            raise ValueError(
                f'Dataset "{dataset.name}" is already registered. Dataset names must be unique.'
            )
        self._datasets[dataset.name] = dataset

    def get(self, name: str) -> Dataset | None:
        """Return the dataset registered under *name*, if any."""

        return self._datasets.get(name)

    def require(self, name: str) -> Dataset:
        """Return the dataset registered under *name*, or raise.

        Used where an unresolvable name is a definition error rather than a
        lookup miss — a relationship pointing at an unregistered dataset, say.
        """

        dataset = self._datasets.get(name)
        if dataset is None:
            known = ", ".join(sorted(self._datasets)) or "(none)"
            raise ValueError(f'Unknown dataset "{name}". Registered datasets: {known}.')
        return dataset

    def get_all(self) -> tuple[Dataset, ...]:
        """Return every registered dataset in registration order."""

        return tuple(self._datasets.values())

    def has(self, name: str) -> bool:
        """Return whether a dataset is registered under *name*."""

        return name in self._datasets


def create_dataset_registry(*datasets: Dataset) -> DatasetRegistry:
    """Create a registry, optionally registering *datasets* in order."""

    registry = DatasetRegistry()
    for dataset in datasets:
        registry.register(dataset)
    return registry
