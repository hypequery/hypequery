"""PYB-03: the SQL portability compiler against the shared fixture corpus.

Parity with `@hypequery/datasets` is the point of these tests: the same SQL
must produce the same expression tree, the same sorted dependencies, and — for
rejected input — the same issue code at the same source offset.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.datasets import (
    SqlPortabilityLimits,
    compile_portable_sql_expression,
)
from hypequery.protocol import (
    ProtocolExpressionError,
    ProtocolLiteralExpression,
    ProtocolReferenceExpression,
    expression_to_data,
)
from hypequery.protocol.expression_fixtures import normalize_expression_wire_numbers

FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "specs"
    / "security-protocol"
    / "fixtures"
    / "sql-portability-v1"
)
ISSUE_CODES = {
    "HQ_SQL_PORT_SYNTAX",
    "HQ_SQL_PORT_UNSUPPORTED_FUNCTION",
    "HQ_SQL_PORT_UNSUPPORTED_OPERATOR",
    "HQ_SQL_PORT_UNSUPPORTED_LITERAL",
    "HQ_SQL_PORT_UNSUPPORTED_SYNTAX",
    "HQ_SQL_PORT_TOO_COMPLEX",
    "HQ_SQL_PORT_TOO_LARGE",
}


def _fixtures(name: str) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], json.loads((FIXTURES / name).read_text()))


@pytest.mark.parametrize("fixture", _fixtures("portable.json"), ids=lambda item: str(item["id"]))
def test_shared_portable_fixtures(fixture: dict[str, object]) -> None:
    result = compile_portable_sql_expression(cast(str, fixture["sql"]))

    assert result.portable, result
    # Fixture JSON has already lost JavaScript's binary64 number semantics, so
    # normalize the expectation the way the expressions-v1 adapter does.
    assert expression_to_data(result.expression) == normalize_expression_wire_numbers(
        fixture["expression"]
    )
    assert list(result.dependencies) == fixture["dependencies"]


@pytest.mark.parametrize(
    "fixture", _fixtures("non-portable.json"), ids=lambda item: str(item["id"])
)
def test_shared_non_portable_fixtures(fixture: dict[str, object]) -> None:
    result = compile_portable_sql_expression(cast(str, fixture["sql"]))

    assert not result.portable
    issue = result.issues[0]
    assert issue.code == fixture["code"]
    assert issue.start == fixture["start"]
    assert issue.end >= issue.start


@pytest.mark.parametrize(
    "fixture", _fixtures("non-portable.json"), ids=lambda item: str(item["id"])
)
def test_issue_messages_never_echo_the_rejected_value(fixture: dict[str, object]) -> None:
    """Messages describe the rejected shape; they are not an input mirror."""

    result = compile_portable_sql_expression(cast(str, fixture["sql"]))

    assert not result.portable
    issue = result.issues[0]
    assert issue.code in ISSUE_CODES
    assert "'" not in issue.message


def test_dependencies_are_sorted_and_deduplicated() -> None:
    result = compile_portable_sql_expression("revenue - cost + revenue")

    assert result.portable
    assert result.dependencies == ("cost", "revenue")


def test_string_literal_is_a_value_not_an_identifier() -> None:
    result = compile_portable_sql_expression("status = 'paid'")

    assert result.portable
    comparison = result.expression
    assert comparison.kind == "comparison"
    assert isinstance(comparison.left, ProtocolReferenceExpression)
    assert isinstance(comparison.right, ProtocolLiteralExpression)
    assert comparison.right.value == "paid"
    # A quoted string never contributes a dependency, whatever it spells.
    assert result.dependencies == ("status",)


@pytest.mark.parametrize(
    ("sql", "code"),
    [
        ("revenue; DROP TABLE orders", "HQ_SQL_PORT_UNSUPPORTED_SYNTAX"),
        ("revenue /* comment */", "HQ_SQL_PORT_UNSUPPORTED_SYNTAX"),
        ("sleep(1)", "HQ_SQL_PORT_UNSUPPORTED_FUNCTION"),
        ("`weird name`", "HQ_SQL_PORT_SYNTAX"),
        ("__hypequeryInternal", "HQ_SQL_PORT_SYNTAX"),
        ("revenue !", "HQ_SQL_PORT_UNSUPPORTED_SYNTAX"),
        ("'unterminated", "HQ_SQL_PORT_SYNTAX"),
        ("`unterminated", "HQ_SQL_PORT_SYNTAX"),
        ("orders.", "HQ_SQL_PORT_SYNTAX"),
        ("-revenue", "HQ_SQL_PORT_UNSUPPORTED_OPERATOR"),
        ("age BETWEEN 1", "HQ_SQL_PORT_SYNTAX"),
        ("x IN 1", "HQ_SQL_PORT_SYNTAX"),
        ("x IN ()", "HQ_SQL_PORT_SYNTAX"),
        ("x IN (1 2)", "HQ_SQL_PORT_SYNTAX"),
        ("round(", "HQ_SQL_PORT_SYNTAX"),
        ("-0", "HQ_SQL_PORT_UNSUPPORTED_LITERAL"),
    ],
)
def test_non_portable_inputs_are_rejected(sql: str, code: str) -> None:
    result = compile_portable_sql_expression(sql)

    assert not result.portable
    assert result.issues[0].code == code


def test_unary_plus_and_dotted_backticks_are_portable() -> None:
    result = compile_portable_sql_expression("+`orders`.total")

    assert result.portable
    assert result.dependencies == ("orders.total",)


def test_limits_may_be_lowered_but_not_raised() -> None:
    lowered = SqlPortabilityLimits(max_nodes=3)

    assert compile_portable_sql_expression("a + b", limits=lowered).portable
    deep = compile_portable_sql_expression("a + b + c + d", limits=lowered)
    assert not deep.portable
    assert deep.issues[0].code == "HQ_SQL_PORT_TOO_COMPLEX"

    with pytest.raises(ValueError, match="no greater than"):
        SqlPortabilityLimits(max_depth=17)
    with pytest.raises(ValueError, match="no greater than"):
        SqlPortabilityLimits(max_input_bytes=0)


def test_multibyte_input_is_measured_in_utf8_bytes() -> None:
    limits = SqlPortabilityLimits(max_input_bytes=8)

    assert compile_portable_sql_expression("a = 'ab'", limits=limits).portable
    # Eight characters, ten UTF-8 bytes: only the byte check can reject it.
    oversized = compile_portable_sql_expression("a = 'éé'", limits=limits)
    assert len("a = 'éé'") <= limits.max_input_bytes
    assert not oversized.portable
    assert oversized.issues[0].code == "HQ_SQL_PORT_TOO_LARGE"


def test_depth_beyond_rfc_0003_raises_rather_than_reporting_an_issue() -> None:
    """Pinned parity with ``@hypequery/datasets``, which also raises here.

    A long left-leaning chain stays inside the compiler's own depth limit —
    parsing it never recurses — but the tree it builds is deeper than RFC 0003
    allows, so the protocol validator rejects it after the compiler has
    succeeded. Both implementations surface that as a protocol error rather
    than a portability issue; changing it is a spec-level decision that has to
    move both languages at once.
    """

    sql = " + ".join(f"a{index}" for index in range(20))

    with pytest.raises(ProtocolExpressionError) as raised:
        compile_portable_sql_expression(sql)
    assert raised.value.code == "HQ_EXPRESSION_TOO_DEEP"


def test_issue_offsets_count_utf16_code_units() -> None:
    """An emoji is one ``str`` character but two UTF-16 units, as in TypeScript."""

    sql = "name = '\U0001f600' AND ;"
    result = compile_portable_sql_expression(sql)

    assert not result.portable
    issue = result.issues[0]
    assert (issue.start, issue.end) == (sql.index(";") + 1, sql.index(";") + 2)

    unexpected = compile_portable_sql_expression("a + \U0001f600")
    assert not unexpected.portable
    assert (unexpected.issues[0].start, unexpected.issues[0].end) == (4, 6)
    assert unexpected.issues[0].message == 'Unexpected character "\U0001f600".'
