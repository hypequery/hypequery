"""Recursive-descent parser for the portable SQL-expression subset.

The parser emits RFC 0003 expression *data*, which the compiler then puts
through the protocol validator. Nothing here renders SQL, and no source text
is ever interpolated into a value: literals become tagged protocol values and
identifiers become reference nodes only after RFC 0002 parsing accepts them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from hypequery.protocol import ProtocolIdentifierError, parse_protocol_qualified_identifier

from .errors import fail
from .limits import SqlPortabilityLimits
from .tokenizer import Token

_CALL_ARITY = {
    "nullifzero": (1, 1),
    "coalesce": (2, 2),
    "round": (1, 2),
    "floor": (1, 1),
    "ceil": (1, 1),
}

_CALL_CANONICAL = {
    "nullifzero": "nullIfZero",
    "coalesce": "coalesce",
    "round": "round",
    "floor": "floor",
    "ceil": "ceil",
}

_BINARY_OPERATORS = {"+": "add", "-": "subtract", "*": "multiply", "/": "divide"}

_COMPARISON_OPERATORS = {
    "=": "eq",
    "!=": "neq",
    ">": "gt",
    ">=": "gte",
    "<": "lt",
    "<=": "lte",
}

_CHAINABLE_KEYWORDS = frozenset(("like", "between", "in"))
_SAFE_INTEGER = 2**53 - 1


@dataclass(frozen=True, slots=True)
class ParsedSql:
    """An expression tree plus the sorted logical names it depends on."""

    expression: dict[str, object]
    dependencies: tuple[str, ...]


def _tagged(tag_type: str, values: list[object]) -> dict[str, object]:
    return {"$hypequery": {"type": tag_type, "version": 1, "values": values}}


class _Parser:
    """Parses one token stream. Single use: state is per-expression."""

    def __init__(self, tokens: list[Token], limits: SqlPortabilityLimits) -> None:
        self._tokens = tokens
        self._limits = limits
        self._position = 0
        self._nodes = 0
        self._dependencies: set[str] = set()

    def parse(self) -> ParsedSql:
        if not self._tokens:
            fail("HQ_SQL_PORT_SYNTAX", "The expression is empty.", 0, 0)
        expression = self._parse_or(0)
        rest = self._peek()
        if rest is not None:
            fail("HQ_SQL_PORT_SYNTAX", "Unexpected trailing input.", rest.start, rest.end)
        return ParsedSql(expression=expression, dependencies=tuple(sorted(self._dependencies)))

    # -- token access -------------------------------------------------------

    def _peek(self) -> Token | None:
        if self._position < len(self._tokens):
            return self._tokens[self._position]
        return None

    def _next(self) -> Token:
        token = self._peek()
        if token is None:
            end = self._tokens[-1].end if self._tokens else 0
            fail("HQ_SQL_PORT_SYNTAX", "Unexpected end of expression.", end, end)
        self._position += 1
        return token

    def _previous(self) -> Token:
        return self._tokens[self._position - 1]

    def _at_keyword(self, *values: str) -> bool:
        token = self._peek()
        return token is not None and token.type == "keyword" and token.value in values

    def _at_operator(self, *values: str) -> bool:
        token = self._peek()
        return token is not None and token.type == "operator" and token.value in values

    def _enter(self, depth: int, token: Token) -> None:
        self._nodes += 1
        if self._nodes > self._limits.max_nodes:
            fail(
                "HQ_SQL_PORT_TOO_COMPLEX",
                "The expression exceeds its node limit.",
                token.start,
                token.end,
            )
        if depth > self._limits.max_depth:
            fail(
                "HQ_SQL_PORT_TOO_COMPLEX",
                "The expression exceeds its depth limit.",
                token.start,
                token.end,
            )

    # -- grammar ------------------------------------------------------------

    def _parse_or(self, depth: int) -> dict[str, object]:
        operands = [self._parse_and(depth)]
        while self._at_keyword("or"):
            self._next()
            operands.append(self._parse_and(depth))
        if len(operands) == 1:
            return operands[0]
        self._enter(depth, self._previous())
        return {"kind": "logical", "operator": "or", "operands": operands}

    def _parse_and(self, depth: int) -> dict[str, object]:
        operands = [self._parse_not(depth)]
        while self._at_keyword("and"):
            self._next()
            operands.append(self._parse_not(depth))
        if len(operands) == 1:
            return operands[0]
        self._enter(depth, self._previous())
        return {"kind": "logical", "operator": "and", "operands": operands}

    def _parse_not(self, depth: int) -> dict[str, object]:
        token = self._peek()
        if token is not None and token.type == "keyword" and token.value == "not":
            self._next()
            self._enter(depth + 1, token)
            return {
                "kind": "logical",
                "operator": "not",
                "operand": self._parse_not(depth + 1),
            }
        return self._parse_comparison(depth)

    def _parse_comparison(self, depth: int) -> dict[str, object]:
        left = self._parse_additive(depth)
        token = self._peek()
        if token is None:
            return left

        if token.type == "operator" and token.value in _COMPARISON_OPERATORS:
            self._next()
            operator = _COMPARISON_OPERATORS[token.value]
            right = self._parse_additive(depth)
            self._enter(depth + 1, token)
            self._reject_chained()
            return {"kind": "comparison", "operator": operator, "left": left, "right": right}
        if token.type == "keyword" and token.value == "like":
            self._next()
            right = self._parse_additive(depth)
            self._enter(depth + 1, token)
            self._reject_chained()
            return {"kind": "comparison", "operator": "like", "left": left, "right": right}
        if token.type == "keyword" and token.value == "between":
            return self._parse_between(left, token, depth)
        if token.type == "keyword" and token.value in ("in", "not"):
            self._next()
            if token.value == "not":
                following = self._peek()
                if (
                    following is not None
                    and following.type == "keyword"
                    and following.value == "in"
                ):
                    self._next()
                    return self._parse_in_list(left, "notIn", token, depth)
                fail(
                    "HQ_SQL_PORT_UNSUPPORTED_OPERATOR",
                    "Only NOT IN is portable; NOT LIKE and NOT BETWEEN are not.",
                    token.start,
                    (following or token).end,
                )
            return self._parse_in_list(left, "in", token, depth)
        return left

    def _reject_chained(self) -> None:
        token = self._peek()
        if token is None:
            return
        chained = (token.type == "operator" and token.value in _COMPARISON_OPERATORS) or (
            token.type == "keyword" and token.value in _CHAINABLE_KEYWORDS
        )
        if chained:
            fail(
                "HQ_SQL_PORT_SYNTAX",
                "Chained comparisons are not portable; combine them with AND/OR.",
                token.start,
                token.end,
            )

    def _parse_between(
        self, left: dict[str, object], token: Token, depth: int
    ) -> dict[str, object]:
        self._next()
        lower = self._parse_additive(depth)
        junction = self._peek()
        if junction is None or junction.type != "keyword" or junction.value != "and":
            fail(
                "HQ_SQL_PORT_SYNTAX",
                "BETWEEN requires an AND separator.",
                junction.start if junction else token.end,
                junction.end if junction else token.end,
            )
        self._next()
        upper = self._parse_additive(depth)
        self._enter(depth + 1, token)
        self._reject_chained()
        bounds: list[object] = []
        for bound in (lower, upper):
            if bound.get("kind") != "literal":
                fail(
                    "HQ_SQL_PORT_UNSUPPORTED_SYNTAX",
                    "BETWEEN bounds must be literal values.",
                    token.start,
                    token.end,
                )
            bounds.append(bound["value"])
        return {
            "kind": "comparison",
            "operator": "between",
            "left": left,
            "right": {"kind": "literal", "value": _tagged("tuple", bounds)},
        }

    def _parse_in_list(
        self, left: dict[str, object], operator: str, token: Token, depth: int
    ) -> dict[str, object]:
        open_token = self._peek()
        if open_token is None or open_token.type != "operator" or open_token.value != "(":
            fail(
                "HQ_SQL_PORT_SYNTAX",
                "IN requires a parenthesized literal list.",
                token.start,
                token.end,
            )
        self._next()
        if self._at_operator(")"):
            fail(
                "HQ_SQL_PORT_SYNTAX",
                "IN requires at least one element.",
                open_token.start,
                open_token.end,
            )
        values: list[object] = []
        while True:
            element = self._parse_unary(depth + 1)
            if element.get("kind") != "literal":
                fail(
                    "HQ_SQL_PORT_UNSUPPORTED_SYNTAX",
                    "IN list elements must be literal values.",
                    token.start,
                    token.end,
                )
            values.append(element["value"])
            separator = self._peek()
            if separator is not None and separator.type == "operator" and separator.value == ",":
                self._next()
                following = self._peek()
                if (
                    following is not None
                    and following.type == "operator"
                    and following.value == ")"
                ):
                    fail(
                        "HQ_SQL_PORT_SYNTAX",
                        "IN lists do not allow a trailing comma.",
                        separator.start,
                        following.end,
                    )
                continue
            if separator is not None and separator.type == "operator" and separator.value == ")":
                self._next()
                break
            fail(
                "HQ_SQL_PORT_SYNTAX",
                'Expected "," or ")" in the IN list.',
                separator.start if separator else token.end,
                separator.end if separator else token.end,
            )
        self._enter(depth + 1, token)
        self._reject_chained()
        return {
            "kind": "comparison",
            "operator": operator,
            "left": left,
            "right": {"kind": "literal", "value": _tagged("array", values)},
        }

    def _parse_additive(self, depth: int) -> dict[str, object]:
        left = self._parse_multiplicative(depth)
        while self._at_operator("+", "-"):
            token = self._next()
            right = self._parse_multiplicative(depth + 1)
            self._enter(depth + 1, token)
            left = {
                "kind": "binary",
                "operator": _BINARY_OPERATORS[token.value],
                "left": left,
                "right": right,
            }
        return left

    def _parse_multiplicative(self, depth: int) -> dict[str, object]:
        left = self._parse_unary(depth)
        while self._at_operator("*", "/"):
            token = self._next()
            right = self._parse_unary(depth + 1)
            self._enter(depth + 1, token)
            left = {
                "kind": "binary",
                "operator": _BINARY_OPERATORS[token.value],
                "left": left,
                "right": right,
            }
        return left

    def _parse_unary(self, depth: int) -> dict[str, object]:
        while self._at_operator("+"):
            self._next()
        if self._at_operator("-"):
            token = self._next()
            operand = self._peek()
            if operand is None or operand.type != "number":
                fail(
                    "HQ_SQL_PORT_UNSUPPORTED_OPERATOR",
                    "Negation is only portable on numeric literals.",
                    token.start,
                    token.end,
                )
            self._next()
            return self._numeric_literal(operand, negated=True)
        return self._parse_primary(depth)

    def _parse_primary(self, depth: int) -> dict[str, object]:
        token = self._next()
        self._enter(depth, token)
        if token.type == "number":
            return self._numeric_literal(token, negated=False)
        if token.type == "string":
            return {"kind": "literal", "value": token.value}
        if token.type == "keyword":
            if token.value == "true":
                return {"kind": "literal", "value": True}
            if token.value == "false":
                return {"kind": "literal", "value": False}
            if token.value == "null":
                return {"kind": "literal", "value": None}
        elif token.type == "identifier":
            if self._at_operator("("):
                return self._parse_call(token, depth)
            return self._reference(token)
        elif token.type == "operator" and token.value == "(":
            expression = self._parse_or(depth + 1)
            close = self._peek()
            if close is None or close.type != "operator" or close.value != ")":
                fail(
                    "HQ_SQL_PORT_SYNTAX",
                    'Expected ")".',
                    close.start if close else token.end,
                    close.end if close else token.end,
                )
            self._next()
            return expression
        fail("HQ_SQL_PORT_SYNTAX", f'Unexpected "{token.value}".', token.start, token.end)

    def _reference(self, token: Token) -> dict[str, object]:
        try:
            name = parse_protocol_qualified_identifier(token.value)
        except ProtocolIdentifierError:
            fail(
                "HQ_SQL_PORT_SYNTAX",
                f'Identifier "{token.value}" is not portable.',
                token.start,
                token.end,
            )
        self._dependencies.add(token.value)
        return {"kind": "reference", "name": name}

    def _parse_call(self, name: Token, depth: int) -> dict[str, object]:
        key = name.value.lower()
        canonical = _CALL_CANONICAL.get(key)
        arity = _CALL_ARITY.get(key)
        if canonical is None or arity is None:
            # The caller only enters here after peeking "(", so this is present.
            open_token = self._tokens[self._position]
            fail(
                "HQ_SQL_PORT_UNSUPPORTED_FUNCTION",
                f'Function "{name.value}" is not in the portable allowlist.',
                name.start,
                open_token.end,
            )
        self._next()  # consume "("
        args: list[dict[str, object]] = []
        if not self._at_operator(")"):
            while True:
                args.append(self._parse_or(depth + 1))
                if not self._at_operator(","):
                    break
                self._next()
        close = self._peek()
        if close is None or close.type != "operator" or close.value != ")":
            fail(
                "HQ_SQL_PORT_SYNTAX",
                'Expected ")".',
                close.start if close else name.end,
                close.end if close else name.end,
            )
        self._next()
        if not arity[0] <= len(args) <= arity[1]:
            expected = str(arity[0]) if arity[0] == arity[1] else f"{arity[0]} to {arity[1]}"
            fail(
                "HQ_SQL_PORT_SYNTAX",
                f'Function "{canonical}" expects {expected} arguments.',
                name.start,
                close.end,
            )
        return {"kind": "call", "function": canonical, "args": args}

    def _numeric_literal(self, token: Token, *, negated: bool) -> dict[str, object]:
        value = float(token.value) * (-1.0 if negated else 1.0)
        unsafe_integer = value.is_integer() and abs(value) > _SAFE_INTEGER
        negative_zero = value == 0 and math.copysign(1.0, value) < 0
        if not math.isfinite(value) or negative_zero or unsafe_integer:
            fail(
                "HQ_SQL_PORT_UNSUPPORTED_LITERAL",
                f'Numeric literal "{token.value}" is outside the portable range.',
                token.start,
                token.end,
            )
        return {"kind": "literal", "value": value}


def parse_portable_sql(tokens: list[Token], limits: SqlPortabilityLimits) -> ParsedSql:
    """Parse a portable token stream into RFC 0003 expression data."""

    return _Parser(tokens, limits).parse()
