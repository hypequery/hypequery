"""Safe identifier nodes.

A planner never concatenates a caller's string into SQL, but it does place
names there — a table, a column, a join alias. Each one becomes a node here
first: validated as an RFC 0002 identifier, then quoted. Two steps rather than
one, because quoting alone would happily render a name no schema can contain,
and validation alone would leave a keyword like `table` to break the statement.
"""

from __future__ import annotations

from dataclasses import dataclass

from hypequery.protocol import ProtocolIdentifierError, parse_protocol_identifier

from .errors import CompiledQueryError


@dataclass(frozen=True, slots=True)
class SafeIdentifier:
    """A validated name and the only SQL form it may be written in."""

    name: str

    @property
    def sql(self) -> str:
        """The backtick-quoted form, with any backtick in the name doubled."""

        return "`" + self.name.replace("`", "``") + "`"

    def __str__(self) -> str:
        return self.sql


@dataclass(frozen=True, slots=True)
class SafeQualifiedIdentifier:
    """A dotted name, quoted per segment rather than as one string."""

    segments: tuple[SafeIdentifier, ...]

    @property
    def sql(self) -> str:
        return ".".join(segment.sql for segment in self.segments)

    def __str__(self) -> str:
        return self.sql


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
