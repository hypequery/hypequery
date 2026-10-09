"""Immutable symbolic formula values used by dataset definitions."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Final, Literal, TypeAlias, cast

from pydantic import SerializeAsAny, field_validator

from hypequery.protocol import ProtocolExpression, validate_protocol_expression

from ._base import DefinitionModel
from .validation import validate_qualified_identifier


class _Formula(DefinitionModel):
    """Internal base shared by the closed public formula union."""


class FormulaReference(_Formula):
    kind: Literal["reference"] = "reference"
    name: str

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        return validate_qualified_identifier(value)


class FormulaLiteral(_Formula):
    kind: Literal["literal"] = "literal"
    value: bool | int | float | None


class FormulaBinary(_Formula):
    kind: Literal["binary"] = "binary"
    operator: Literal["add", "subtract", "multiply", "divide"]
    left: SerializeAsAny[Formula]
    right: SerializeAsAny[Formula]


class FormulaCall(_Formula):
    kind: Literal["call"] = "call"
    name: Literal["nullIfZero", "coalesce", "round", "floor", "ceil"]
    args: tuple[SerializeAsAny[Formula], ...]


Formula: TypeAlias = FormulaReference | FormulaLiteral | FormulaBinary | FormulaCall
FormulaBinary.model_rebuild()
FormulaCall.model_rebuild()

#: The argument count each formula function takes, matching TypeScript.
FORMULA_FUNCTION_ARITIES: Final[Mapping[str, int]] = {
    "nullIfZero": 1,
    "coalesce": 2,
    "round": 2,
    "floor": 1,
    "ceil": 1,
}


def formula_children(formula: Formula) -> tuple[Formula, ...]:
    """The direct operands of *formula*; references and literals have none."""

    if isinstance(formula, FormulaBinary):
        return (formula.left, formula.right)
    if isinstance(formula, FormulaCall):
        return formula.args
    return ()


FormulaInput: TypeAlias = str | bool | int | float | Formula | None


def _operand(value: FormulaInput) -> Formula:
    if isinstance(value, _Formula):
        return value
    if type(value) is str:
        return FormulaReference(name=value)
    return FormulaLiteral(value=cast(bool | int | float | None, value))


def _formula_data(value: Formula) -> dict[str, object]:
    if isinstance(value, FormulaReference):
        return {"kind": "reference", "name": value.name}
    if isinstance(value, FormulaLiteral):
        literal = value.value
        if type(literal) is int:
            try:
                number = float(literal)
            except OverflowError as error:
                raise ValueError(
                    "formula integer literal must be exactly representable as a protocol number"
                ) from error
            if not math.isfinite(number) or int(number) != literal:
                raise ValueError(
                    "formula integer literal must be exactly representable as a protocol number"
                )
            literal = number
        return {"kind": "literal", "value": literal}
    if isinstance(value, FormulaBinary):
        return {
            "kind": "binary",
            "operator": value.operator,
            "left": _formula_data(value.left),
            "right": _formula_data(value.right),
        }
    return {
        "kind": "call",
        "function": value.name,
        "args": [_formula_data(item) for item in value.args],
    }


def compile_formula(value: FormulaInput) -> ProtocolExpression:
    """Compile a symbolic dataset formula into the validated portable AST."""

    return validate_protocol_expression(_formula_data(_operand(value)))


def divide(left: FormulaInput, right: FormulaInput) -> FormulaBinary:
    return FormulaBinary(operator="divide", left=_operand(left), right=_operand(right))


def multiply(left: FormulaInput, right: FormulaInput) -> FormulaBinary:
    return FormulaBinary(operator="multiply", left=_operand(left), right=_operand(right))


def subtract(left: FormulaInput, right: FormulaInput) -> FormulaBinary:
    return FormulaBinary(operator="subtract", left=_operand(left), right=_operand(right))


def add(left: FormulaInput, right: FormulaInput) -> FormulaBinary:
    return FormulaBinary(operator="add", left=_operand(left), right=_operand(right))


def null_if_zero(value: FormulaInput) -> FormulaCall:
    return FormulaCall(name="nullIfZero", args=(_operand(value),))


def coalesce(value: FormulaInput, fallback: FormulaInput) -> FormulaCall:
    return FormulaCall(name="coalesce", args=(_operand(value), _operand(fallback)))


def round(value: FormulaInput, decimals: int = 0) -> FormulaCall:  # noqa: A001
    return FormulaCall(name="round", args=(_operand(value), FormulaLiteral(value=decimals)))


def floor(value: FormulaInput) -> FormulaCall:
    return FormulaCall(name="floor", args=(_operand(value),))


def ceil(value: FormulaInput) -> FormulaCall:
    return FormulaCall(name="ceil", args=(_operand(value),))


class _FormulaHelpers:
    """Formula helper namespace for derived measures, matching `measure` and `filter`.

    ``formula.divide("revenue", formula.null_if_zero("orders"))`` builds the
    symbolic expression `measure.derived` takes. A string operand names a
    measure on the same dataset; a number is a literal.
    """

    add = staticmethod(add)
    subtract = staticmethod(subtract)
    multiply = staticmethod(multiply)
    divide = staticmethod(divide)
    null_if_zero = staticmethod(null_if_zero)
    coalesce = staticmethod(coalesce)
    round = staticmethod(round)
    floor = staticmethod(floor)
    ceil = staticmethod(ceil)


formula = _FormulaHelpers()
