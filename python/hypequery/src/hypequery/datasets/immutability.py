"""Immutable snapshots for nested dataset definition data."""

from __future__ import annotations

import math
from collections.abc import Iterator, Mapping
from types import MappingProxyType
from typing import Generic, NoReturn, TypeVar, cast

_Key = TypeVar("_Key")
_Value = TypeVar("_Value")


class FrozenMapping(Mapping[_Key, _Value], Generic[_Key, _Value]):
    """A read-only mapping that snapshots its input."""

    __slots__ = ("_values",)
    _values: Mapping[_Key, _Value]

    def __init__(self, values: Mapping[_Key, _Value]) -> None:
        object.__setattr__(self, "_values", MappingProxyType(dict(values)))

    def __getitem__(self, key: _Key) -> _Value:
        return self._values[key]

    def __iter__(self) -> Iterator[_Key]:
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __setattr__(self, name: str, value: object) -> NoReturn:
        raise TypeError("FrozenMapping is immutable")


def freeze_mapping(values: Mapping[_Key, _Value]) -> Mapping[_Key, _Value]:
    """Return an immutable snapshot with the same static mapping type."""

    return FrozenMapping(values)


def freeze_json_value(value: object) -> object:
    """Validate and recursively freeze a strict JSON-compatible value."""

    if value is None or type(value) in (bool, int, str):
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError("filter values must be finite")
        return value
    if type(value) is list:
        return tuple(freeze_json_value(item) for item in cast(list[object], value))
    if type(value) is dict:
        frozen: dict[str, object] = {}
        for key, item in cast(dict[object, object], value).items():
            if type(key) is not str:
                raise ValueError("filter object keys must be strings")
            frozen[key] = freeze_json_value(item)
        return FrozenMapping(frozen)
    raise ValueError("filter values must contain only strict JSON data")


def thaw_json_value(value: object) -> object:
    """Return ordinary JSON containers for Pydantic serialization."""

    if isinstance(value, FrozenMapping):
        return {key: thaw_json_value(item) for key, item in value.items()}
    if type(value) is tuple:
        return [thaw_json_value(item) for item in value]
    return value
