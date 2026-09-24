"""Source-located incompatibility reports for the SQL portability compiler."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, NoReturn, TypeAlias

SqlPortabilityIssueCode: TypeAlias = Literal[
    "HQ_SQL_PORT_SYNTAX",
    "HQ_SQL_PORT_UNSUPPORTED_FUNCTION",
    "HQ_SQL_PORT_UNSUPPORTED_OPERATOR",
    "HQ_SQL_PORT_UNSUPPORTED_LITERAL",
    "HQ_SQL_PORT_UNSUPPORTED_SYNTAX",
    "HQ_SQL_PORT_TOO_COMPLEX",
    "HQ_SQL_PORT_TOO_LARGE",
]


@dataclass(frozen=True, slots=True)
class SqlPortabilityIssue:
    """One reason an expression is not portable, located in its source text.

    ``start`` and ``end`` are offsets into the original string, so a caller can
    underline the offending span. Messages describe the *shape* that was
    rejected and never quote a literal value.
    """

    code: SqlPortabilityIssueCode
    message: str
    start: int
    end: int


class SqlPortabilityError(Exception):
    """Internal control flow carrying the issue the compiler will report.

    Callers see :class:`SqlPortabilityFailure` instead; this never escapes
    ``compile_portable_sql_expression``.
    """

    issue: SqlPortabilityIssue

    def __init__(self, issue: SqlPortabilityIssue) -> None:
        super().__init__(issue.code)
        self.issue = issue


def fail(code: SqlPortabilityIssueCode, message: str, start: int, end: int) -> NoReturn:
    """Abandon compilation with a source-located issue."""

    raise SqlPortabilityError(SqlPortabilityIssue(code=code, message=message, start=start, end=end))
