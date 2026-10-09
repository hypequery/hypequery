"""Per-request values kept in the ASGI scope under a key only their owner holds.

The key is an object, not a string, so no header, middleware, or request state
can put a value where the owner will read one. Reads check the exact type, so a
look-alike stored by anything else is treated as absent.
"""

from __future__ import annotations

from collections.abc import Callable, MutableMapping
from typing import Any, Generic, TypeVar, cast

from starlette.types import Scope

_T = TypeVar("_T")


class ScopeSlot(Generic[_T]):
    """One typed per-request value, private to the module that creates the slot."""

    __slots__ = ("_key", "_type")

    def __init__(self, value_type: type[_T]) -> None:
        self._key = object()
        self._type = value_type

    @staticmethod
    def _mapping(scope: Scope) -> MutableMapping[object, Any]:
        return cast(MutableMapping[object, Any], scope)

    def get(self, scope: Scope) -> _T | None:
        """The stored value, or None when absent or not exactly the slot's type."""

        value = self._mapping(scope).get(self._key)
        return value if type(value) is self._type else None

    def set(self, scope: Scope, value: _T) -> None:
        self._mapping(scope)[self._key] = value

    def setdefault(self, scope: Scope, factory: Callable[[], _T]) -> _T:
        """The stored value, creating and storing one with *factory* when absent."""

        value = self.get(scope)
        if value is None:
            value = factory()
            self.set(scope, value)
        return value
