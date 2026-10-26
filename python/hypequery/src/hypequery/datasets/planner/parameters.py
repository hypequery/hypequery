"""Typed placeholders and the parameter map they bind to.

Every value a caller influences leaves the SQL text and becomes a parameter.
The statement carries a placeholder the dialect spells — `{name:Type}` on
ClickHouse, `$n` on Postgres — and the value travels beside it, never inside
it. Allocation is central so a name is unique by construction rather than by
a later check, and allocation order is the `$n` order.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from ..dimensions import DimensionType
from .errors import CompiledQueryError

if TYPE_CHECKING:
    from .dialects.base import SqlDialect


@dataclass(frozen=True, slots=True)
class TypedParameter:
    """One declared parameter: its name, its SQL type, its value, and its placeholder."""

    name: str
    #: The type the value binds as, spelled for the compiling dialect.
    sql_type: str
    value: object
    #: The executable form written into the statement, spelled by the dialect.
    #: Defaults to ClickHouse's `{name:Type}` server-parameter syntax.
    placeholder: str = ""

    def __post_init__(self) -> None:
        if not self.placeholder:
            object.__setattr__(self, "placeholder", f"{{{self.name}:{self.sql_type}}}")

    @property
    def debug_placeholder(self) -> str:
        """The redacted form: structure and declared type, never the value.

        Deliberately not ClickHouse syntax. Debug output that could be pasted
        into a client and run is a conformance failure, so the marker has to be
        one no driver will bind.
        """

        return f"<{self.name}:{self.sql_type}>"

    def __repr__(self) -> str:
        # The generated repr would print the value, and a parameter's value is
        # caller data or a tenant identifier. Neither may reach a log line.
        return f"TypedParameter({self.debug_placeholder})"


def clickhouse_type_for(field_type: DimensionType) -> str:
    """The scalar ClickHouse type a logical dimension type binds as.

    Compilation asks its dialect (`SqlDialect.parameter_type`); this remains
    for callers that want the ClickHouse spelling directly.
    """

    from .dialects.clickhouse import PARAMETER_TYPES

    return PARAMETER_TYPES[field_type]


@dataclass(slots=True)
class ParameterBinder:
    """Allocates placeholder names and collects what they bind to."""

    dialect: SqlDialect
    _parameters: dict[str, TypedParameter] = field(default_factory=dict)

    def bind(self, value: object, sql_type: str) -> str:
        """Declare one value and return the placeholder to write into SQL."""

        index = len(self._parameters)
        name = f"p{index}"
        self._parameters[name] = TypedParameter(
            name=name,
            sql_type=sql_type,
            value=value,
            placeholder=self.dialect.placeholder(name, index, sql_type),
        )
        return self._parameters[name].placeholder

    def bind_array(self, values: Sequence[object], element_type: str) -> str:
        """Declare a list value, bound as one array rather than a rendered list.

        Expanding a list into `IN (?, ?, ?)` would put its length into the SQL
        text and make every distinct length a different statement; binding one
        `Array(T)` keeps the text stable and the values out of it.
        """

        return self.bind(list(values), self.dialect.array_type(element_type))

    @property
    def parameters(self) -> Mapping[str, TypedParameter]:
        return dict(self._parameters)


def require_scalar(value: object, *, what: str) -> object:
    """Refuse a value that is not a bindable scalar."""

    if type(value) in (str, int, float, bool) or value is None:
        return value
    raise CompiledQueryError("input-invalid", f"{what} must be a scalar value")


def require_sequence(value: object, *, what: str) -> Sequence[object]:
    """Refuse a value that is not a list of bindable scalars."""

    if type(value) not in (list, tuple):
        raise CompiledQueryError("input-invalid", f"{what} must be a list of values")
    items: Sequence[object] = value  # type: ignore[assignment]
    for item in items:
        require_scalar(item, what=what)
    return items
