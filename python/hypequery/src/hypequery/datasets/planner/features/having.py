"""Conditions on aggregated measure values, applied after grouping."""

from __future__ import annotations

import math
from typing import cast

from ...query_helpers import HavingCondition
from ..errors import CompiledQueryError
from ..operators import ARRAY_OPERATORS, COMPARISON_SQL, membership_keyword
from .base import CompilerFeature


def _finite_number(value: object) -> bool:
    # `bool` is an `int` subclass; a JSON `true` is not a measure value.
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(cast(float, value))
    except OverflowError:
        # An integer beyond float range, such as 10**400.
        return False


def having_numbers(condition: HavingCondition) -> list[float | int]:
    """The condition's values, refused unless they are finite numbers."""

    value, operator, name = condition.value, condition.operator, condition.measure
    if operator == "between":
        if type(value) is tuple and len(value) == 2 and all(map(_finite_number, value)):
            return list(value)
        message = f'Having "between" on "{name}" expects a two-item array of finite numbers.'
    elif operator in ARRAY_OPERATORS:
        if type(value) is tuple and value and all(map(_finite_number, value)):
            return list(value)
        message = f'Having "{operator}" on "{name}" expects a non-empty array of finite numbers.'
    else:
        if _finite_number(value):
            return [cast(float, value)]
        message = f'Having "{operator}" on "{name}" expects a finite number.'
    raise CompiledQueryError("input-invalid", message)


class HavingFeature(CompilerFeature):
    """Conditions on selected measures' aggregates, every value bound as Float64."""

    __slots__ = ()

    def add(self) -> None:
        compiler = self.compiler
        binder, having = compiler.binder, compiler.node.having
        selected = compiler.selected_measures
        measure_sql = compiler.measures.measure_sql
        for condition in compiler.query.having:
            expression = (
                measure_sql.get(condition.measure) if condition.measure in selected else None
            )
            if expression is None:
                raise CompiledQueryError(
                    "input-invalid",
                    f'Having measure "{condition.measure}" must be one of the selected '
                    f"measures: {', '.join(selected)}",
                )
            values = having_numbers(condition)
            operator = condition.operator
            if operator == "between":
                lower = binder.bind(values[0], "Float64")
                upper = binder.bind(values[1], "Float64")
                having.append(f"{expression} BETWEEN {lower} AND {upper}")
            elif operator in ARRAY_OPERATORS:
                placeholder = binder.bind_array(values, "Float64")
                having.append(f"{expression} {membership_keyword(operator)} {placeholder}")
            else:
                placeholder = binder.bind(values[0], "Float64")
                having.append(f"{expression} {COMPARISON_SQL[operator]} {placeholder}")
