"""The SQL portability compiler entry point.

A SQL-backed dimension or measure is portable only when its expression can be
expressed as an RFC 0003 tree. Everything else is reported as a located
incompatibility so the definition can be surfaced as non-portable rather than
executed with engine-specific meaning.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal, TypeAlias

from hypequery.protocol import ProtocolExpression, validate_protocol_expression
from hypequery.protocol.utf8 import exceeds_utf8_byte_limit

from .errors import SqlPortabilityError, SqlPortabilityIssue, fail
from .limits import DEFAULT_SQL_PORTABILITY_LIMITS, SqlPortabilityLimits
from .parser import parse_portable_sql
from .tokenizer import tokenize


@dataclass(frozen=True, slots=True)
class SqlPortabilitySuccess:
    """A compiled expression and the sorted logical names it reads."""

    expression: ProtocolExpression
    dependencies: tuple[str, ...]
    portable: Literal[True] = True


@dataclass(frozen=True, slots=True)
class SqlPortabilityFailure:
    """Why the input is not portable, located in the original source text."""

    issues: tuple[SqlPortabilityIssue, ...]
    portable: Literal[False] = False


SqlPortabilityResult: TypeAlias = SqlPortabilitySuccess | SqlPortabilityFailure


def _utf16_offset(sql: str, index: int) -> int:
    """Convert a ``str`` index into the UTF-16 code-unit offset the spec pins."""

    return index + sum(1 for char in sql[:index] if ord(char) > 0xFFFF)


def _with_utf16_offsets(sql: object, issue: SqlPortabilityIssue) -> SqlPortabilityIssue:
    """Re-express an issue span in UTF-16 code units, as ``@hypequery/datasets`` does.

    The parser works in code points; the two only differ after an astral
    character such as an emoji, which is one code point but two code units.
    """

    if type(sql) is not str or all(ord(char) <= 0xFFFF for char in sql):
        return issue
    return replace(
        issue,
        start=_utf16_offset(sql, issue.start),
        end=_utf16_offset(sql, issue.end),
    )


def compile_portable_sql_expression(
    sql: str,
    *,
    limits: SqlPortabilityLimits = DEFAULT_SQL_PORTABILITY_LIMITS,
) -> SqlPortabilityResult:
    """Compile a SQL expression fragment into an RFC 0003 expression.

    A successful result always passes RFC 0003 validation. ``dependencies``
    are the sorted, deduplicated identifiers the expression references.
    """

    try:
        if type(sql) is not str:
            fail("HQ_SQL_PORT_TOO_LARGE", "The expression exceeds its byte limit.", 0, 0)
        if len(sql) > limits.max_input_bytes or exceeds_utf8_byte_limit(
            sql, limits.max_input_bytes
        ):
            fail(
                "HQ_SQL_PORT_TOO_LARGE",
                "The expression exceeds its byte limit.",
                0,
                len(sql),
            )
        parsed = parse_portable_sql(tokenize(sql), limits)
    except SqlPortabilityError as error:
        return SqlPortabilityFailure(issues=(_with_utf16_offsets(sql, error.issue),))
    return SqlPortabilitySuccess(
        expression=validate_protocol_expression(parsed.expression),
        dependencies=parsed.dependencies,
    )
