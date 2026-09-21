"""Tokenizer for the portable ClickHouse SQL-expression subset.

Anything outside the subset is rejected here rather than being carried into
the parser, so syntax that could change meaning across engines — comments,
statement terminators, casts, subscripts, backslash escapes — never reaches an
expression node.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, TypeAlias

from .errors import fail

TokenType: TypeAlias = Literal["identifier", "number", "string", "operator", "keyword"]


@dataclass(frozen=True, slots=True)
class Token:
    type: TokenType
    value: str
    start: int
    end: int


_BARE_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*", re.ASCII)
_BARE_IDENTIFIER_FULL = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z", re.ASCII)
_NUMBER = re.compile(
    r"[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?",
    re.ASCII,
)
_DIGIT = re.compile(r"[0-9]", re.ASCII)
_IDENTIFIER_START = re.compile(r"[A-Za-z_]", re.ASCII)

#: Keywords with direct AST support, keyed by their uppercase spelling.
_KEYWORDS = {
    "AND": "and",
    "OR": "or",
    "NOT": "not",
    "IN": "in",
    "BETWEEN": "between",
    "LIKE": "like",
    "TRUE": "true",
    "FALSE": "false",
    "NULL": "null",
}

#: Reserved words that prove the input is not a portable expression.
_UNSUPPORTED_KEYWORDS = frozenset(
    (
        "ALTER",
        "AS",
        "CASE",
        "CAST",
        "CREATE",
        "DATABASE",
        "DELETE",
        "DROP",
        "ELSE",
        "END",
        "EXCEPT",
        "EXISTS",
        "FORMAT",
        "FROM",
        "GROUP",
        "HAVING",
        "INSERT",
        "INTERSECT",
        "INTO",
        "JOIN",
        "LAMBDA",
        "LIMIT",
        "ORDER",
        "OVER",
        "PARTITION",
        "PREWHERE",
        "SELECT",
        "SETTINGS",
        "TABLE",
        "THEN",
        "TRUNCATE",
        "UNION",
        "UPDATE",
        "WHEN",
        "WHERE",
        "WINDOW",
        "WITH",
    )
)

_WHITESPACE = frozenset(" \t\n\r")
_PUNCTUATION = frozenset("(),")
_ARITHMETIC = frozenset("+-*/")
_UNSUPPORTED_OPERATOR_CHARS = frozenset("%^&|~:?@")
_UNSUPPORTED_SYNTAX_CHARS = frozenset(';[]{}"$#')


def _char_at(sql: str, index: int) -> str:
    """Return one character, or ``""`` past the end, as JavaScript indexing does."""

    return sql[index] if 0 <= index < len(sql) else ""


def _tokenize_string(sql: str, start: int) -> Token:
    index = start + 1
    value = ""
    closed = False
    while index < len(sql):
        current = sql[index]
        if current == "'":
            if _char_at(sql, index + 1) == "'":
                value += "'"
                index += 2
                continue
            closed = True
            index += 1
            break
        if current == "\\":
            fail(
                "HQ_SQL_PORT_UNSUPPORTED_LITERAL",
                "Backslash escapes are not portable; double the quote instead.",
                index,
                index + 1,
            )
        value += current
        index += 1
    if not closed:
        fail("HQ_SQL_PORT_SYNTAX", "Unterminated string literal.", start, len(sql))
    return Token(type="string", value=value, start=start, end=index)


def _tokenize_quoted_segment(sql: str, start: int, index: int) -> tuple[str, int]:
    """Read one backtick-quoted identifier segment beginning at *index*."""

    index += 1
    segment = ""
    closed = False
    while index < len(sql):
        if sql[index] == "`":
            if _char_at(sql, index + 1) == "`":
                segment += "`"
                index += 2
                continue
            closed = True
            index += 1
            break
        segment += sql[index]
        index += 1
    if not closed:
        fail("HQ_SQL_PORT_SYNTAX", "Unterminated quoted identifier.", start, len(sql))
    if _BARE_IDENTIFIER_FULL.match(segment) is None:
        fail(
            "HQ_SQL_PORT_SYNTAX",
            f'Quoted identifier "{segment}" is not portable.',
            start,
            index,
        )
    return segment, index


def _tokenize_name(sql: str, start: int) -> Token:
    """Read a bare or backtick-quoted, optionally dot-qualified name."""

    segments: list[str] = []
    bare_only = True
    index = start
    while True:
        if _char_at(sql, index) == "`":
            bare_only = False
            segment, index = _tokenize_quoted_segment(sql, start, index)
            segments.append(segment)
        else:
            bare = _BARE_IDENTIFIER.match(sql, index)
            if bare is None:
                break
            segments.append(bare.group())
            index = bare.end()
        if _char_at(sql, index) == ".":
            following = _char_at(sql, index + 1)
            if following == "`" or _IDENTIFIER_START.match(following) is not None:
                index += 1
                continue
            fail("HQ_SQL_PORT_SYNTAX", 'Expected an identifier after ".".', index, index + 1)
        break

    value = ".".join(segments)
    if bare_only and len(segments) == 1:
        upper = value.upper()
        keyword = _KEYWORDS.get(upper)
        if keyword is not None:
            return Token(type="keyword", value=keyword, start=start, end=index)
        if upper in _UNSUPPORTED_KEYWORDS:
            fail(
                "HQ_SQL_PORT_UNSUPPORTED_SYNTAX",
                f'"{value}" is not part of the portable expression subset.',
                start,
                index,
            )
    return Token(type="identifier", value=value, start=start, end=index)


def _tokenize_operator(sql: str, start: int) -> Token:
    """Read a comparison operator beginning with ``=``, ``<``, or ``>``."""

    char = sql[start]
    following = _char_at(sql, start + 1)
    if char == "=" and following == "=":
        fail(
            "HQ_SQL_PORT_UNSUPPORTED_OPERATOR",
            'Operator "==" is not portable; use "=" for equality.',
            start,
            start + 2,
        )
    if char == "<" and following == ">":
        return Token(type="operator", value="!=", start=start, end=start + 2)
    if char in "<>" and following == "=":
        return Token(type="operator", value=f"{char}=", start=start, end=start + 2)
    return Token(type="operator", value=char, start=start, end=start + 1)


def tokenize(sql: str) -> list[Token]:
    """Split *sql* into portable tokens, failing on anything outside the subset."""

    tokens: list[Token] = []
    index = 0
    while index < len(sql):
        start = index
        char = sql[index]
        following = _char_at(sql, index + 1)
        if char in _WHITESPACE:
            index += 1
            continue
        if (char == "-" and following == "-") or (char == "/" and following == "*"):
            fail("HQ_SQL_PORT_UNSUPPORTED_SYNTAX", "Comments are not portable.", start, start + 2)
        if char in _PUNCTUATION or char in _ARITHMETIC:
            tokens.append(Token(type="operator", value=char, start=start, end=start + 1))
            index += 1
            continue
        if char == "!":
            if following != "=":
                fail(
                    "HQ_SQL_PORT_UNSUPPORTED_SYNTAX",
                    'Unexpected character "!".',
                    start,
                    start + 1,
                )
            tokens.append(Token(type="operator", value="!=", start=start, end=start + 2))
            index += 2
            continue
        if char in "=<>":
            token = _tokenize_operator(sql, start)
            tokens.append(token)
            index = token.end
            continue
        if char in _UNSUPPORTED_OPERATOR_CHARS:
            fail(
                "HQ_SQL_PORT_UNSUPPORTED_OPERATOR",
                f'Operator "{char}" is not portable.',
                start,
                start + 1,
            )
        if char in _UNSUPPORTED_SYNTAX_CHARS:
            fail(
                "HQ_SQL_PORT_UNSUPPORTED_SYNTAX",
                f'Syntax "{char}" is not portable.',
                start,
                start + 1,
            )
        if char == "'":
            token = _tokenize_string(sql, start)
            tokens.append(token)
            index = token.end
            continue
        if _DIGIT.match(char) is not None or (char == "." and _DIGIT.match(following) is not None):
            number = _NUMBER.match(sql, index)
            if number is None:  # pragma: no cover - the guard above proves a match
                fail("HQ_SQL_PORT_SYNTAX", "Malformed numeric literal.", start, start + 1)
            tokens.append(Token(type="number", value=number.group(), start=start, end=number.end()))
            index = number.end()
            continue
        if char == "`" or _IDENTIFIER_START.match(char) is not None:
            token = _tokenize_name(sql, start)
            tokens.append(token)
            index = token.end
            continue
        fail("HQ_SQL_PORT_UNSUPPORTED_SYNTAX", f'Unexpected character "{char}".', start, start + 1)
    return tokens
