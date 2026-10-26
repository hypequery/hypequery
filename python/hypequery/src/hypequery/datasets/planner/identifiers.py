"""Safe identifier nodes.

A planner never concatenates a caller's string into SQL, but it does place
names there — a table, a column, a join alias. Each one becomes a node here
first: validated as an RFC 0002 identifier, then quoted by the dialect. Two
steps rather than one, because quoting alone would happily render a name no
schema can contain, and validation alone would leave a keyword like `table`
to break the statement.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from hypequery.protocol import ProtocolIdentifierError, parse_protocol_identifier

from .errors import CompiledQueryError

if TYPE_CHECKING:
    from .dialects.base import SqlDialect


@dataclass(frozen=True, slots=True)
class SafeIdentifier:
    """A validated name. Its SQL form is the dialect's: see `SqlDialect.quote`."""

    name: str


@dataclass(frozen=True, slots=True)
class SafeQualifiedIdentifier:
    """A dotted name, quoted per segment rather than as one string."""

    segments: tuple[SafeIdentifier, ...]


def safe_identifier(value: str, *, what: str) -> SafeIdentifier:
    """Validate one name, reporting an invalid one as caller input."""

    try:
        return SafeIdentifier(parse_protocol_identifier(value))
    except ProtocolIdentifierError as error:
        raise CompiledQueryError(
            "input-invalid", f"{what} is not a valid identifier: {value!r}"
        ) from error


def safe_qualified_identifier(value: str, *, what: str) -> SafeQualifiedIdentifier:
    """Validate a dotted name segment by segment.

    A physical source is often `database.table`. Quoting the whole string would
    produce one identifier containing a dot, which names a table nobody has, so
    each segment is validated and quoted on its own.
    """

    segments = value.split(".")
    return SafeQualifiedIdentifier(
        tuple(safe_identifier(segment, what=what) for segment in segments)
    )


def quoted(dialect: SqlDialect, identifier: SafeIdentifier | SafeQualifiedIdentifier) -> str:
    """*identifier* in *dialect*'s quoted form, segment by segment when qualified."""

    if isinstance(identifier, SafeQualifiedIdentifier):
        return ".".join(dialect.quote(segment.name) for segment in identifier.segments)
    return dialect.quote(identifier.name)
