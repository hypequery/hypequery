"""Derived-measure formulas as SQL, over whatever the caller says a reference reads.

A grouped query reads a reference as that measure's aggregate; a window or
shift query reads it as the already-aggregated column of the same name.
Literals are bound, in the order the formula reads them.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import cast

from ..formulas import Formula, FormulaBinary, FormulaLiteral, FormulaReference
from ..utils.derived_measures import literal_parameter_type
from .dialects import SqlDialect
from .parameters import ParameterBinder

_OPERATORS = {"add": "+", "subtract": "-", "multiply": "*"}
_FUNCTIONS = {"coalesce": "COALESCE", "round": "ROUND", "floor": "FLOOR", "ceil": "CEIL"}


def formula_sql(
    formula: Formula,
    reference: Callable[[str], str],
    binder: ParameterBinder,
    dialect: SqlDialect,
) -> str:
    def render(node: Formula) -> str:
        if isinstance(node, FormulaReference):
            return reference(node.name)
        if isinstance(node, FormulaLiteral):
            if node.value is None:
                return "NULL"
            # Bind as ClickHouse would type the same literal written inline.
            return binder.bind(node.value, literal_parameter_type(node.value))
        if isinstance(node, FormulaBinary):
            left, right = render(node.left), render(node.right)
            if node.operator == "divide":
                return dialect.divide(left, right)
            return f"({left} {_OPERATORS[node.operator]} {right})"
        if node.name == "round":
            decimals = cast(FormulaLiteral, node.args[1])
            decimal_parameter = binder.bind(decimals.value, "Int64")
            expression = render(node.args[0])
            return f"ROUND({expression}, {decimal_parameter})"
        args = [render(arg) for arg in node.args]
        if node.name == "nullIfZero":
            return f"NULLIF({args[0]}, 0)"
        return f"{_FUNCTIONS[node.name]}({', '.join(args)})"

    return render(formula)
