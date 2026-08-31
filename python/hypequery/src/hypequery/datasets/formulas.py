"""Immutable symbolic formula values used by dataset definitions."""

from __future__ import annotations

from typing import Literal, TypeAlias, cast

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
    left: SerializeAsAny[_Formula]
    right: SerializeAsAny[_Formula]


class FormulaCall(_Formula):
    kind: Literal["call"] = "call"
    name: Literal["nullIfZero", "coalesce", "round", "floor", "ceil"]
    args: tuple[SerializeAsAny[_Formula], ...]


Formula: TypeAlias = FormulaReference | FormulaLiteral | FormulaBinary | FormulaCall
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
        literal = float(value.value) if type(value.value) is int else value.value
        return {"kind": "literal", "value": literal}
    if isinstance(value, FormulaBinary):
        return {
            "kind": "binary",
            "operator": value.operator,
            "left": _formula_data(cast(Formula, value.left)),
            "right": _formula_data(cast(Formula, value.right)),
        }
    return {
        "kind": "call",
        "function": value.name,
        "args": [_formula_data(cast(Formula, item)) for item in value.args],
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
