"""Named typed placeholders and the parameter map they bind to.

Every value a caller influences leaves the SQL text and becomes a parameter.
The statement carries `{name:Type}` — ClickHouse's own server-parameter syntax —
and the value travels beside it, never inside it. Allocation is central so a
name is unique by construction rather than by a later check.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from ..dimensions import DimensionType
from .errors import CompiledQueryError

#: The ClickHouse type each declared dimension type binds as. These are the
#: widest safe reading of a logical type; PYC-01's executor narrows them against
#: the real column type, which is the only place the physical schema is known.
_CLICKHOUSE_TYPES: Mapping[DimensionType, str] = {
    "string": "String",
    "number": "Float64",
    "boolean": "Bool",
    "timestamp": "DateTime64(3)",
}


@dataclass(frozen=True, slots=True)
class TypedParameter:
    """One declared parameter: its name, its ClickHouse type, and its value."""

    name: str
    clickhouse_type: str
    value: object

    @property
    def placeholder(self) -> str:
        """The executable form, bound by the driver's server parameters."""

        return f"{{{self.name}:{self.clickhouse_type}}}"

    @property
    def debug_placeholder(self) -> str:
        """The redacted form: structure and declared type, never the value.

        Deliberately not ClickHouse syntax. Debug output that could be pasted
        into a client and run is a conformance failure, so the marker has to be
        one no driver will bind.
        """

        return f"<{self.name}:{self.clickhouse_type}>"


def clickhouse_type_for(field_type: DimensionType) -> str:
    """The scalar ClickHouse type a logical dimension type binds as."""

    return _CLICKHOUSE_TYPES[field_type]


@dataclass(slots=True)
class ParameterBinder:
    """Allocates placeholder names and collects what they bind to."""

    _parameters: dict[str, TypedParameter] = field(default_factory=dict)

    def bind(self, value: object, clickhouse_type: str) -> str:
        """Declare one value and return the placeholder to write into SQL."""

        name = f"p{len(self._parameters)}"
        self._parameters[name] = TypedParameter(
            name=name, clickhouse_type=clickhouse_type, value=value
        )
        return self._parameters[name].placeholder

    def bind_array(self, values: Sequence[object], element_type: str) -> str:
        """Declare a list value, bound as one array rather than a rendered list.

        Expanding a list into `IN (?, ?, ?)` would put its length into the SQL
        text and make every distinct length a different statement; binding one
        `Array(T)` keeps the text stable and the values out of it.
        """

        return self.bind(list(values), f"Array({element_type})")

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
