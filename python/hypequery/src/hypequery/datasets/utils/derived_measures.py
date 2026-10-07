"""Derived-measure validation and portable representation."""

from __future__ import annotations

from collections.abc import Mapping

from hypequery.protocol.expression_models import expression_to_data

from ..derived_measures import DerivedMeasure
from ..dimensions import Dimension
from ..formulas import (
    Formula,
    FormulaBinary,
    FormulaCall,
    FormulaLiteral,
    FormulaReference,
    compile_formula,
)
from ..measures import Measure


def formula_references(formula: Formula) -> tuple[str, ...]:
    if isinstance(formula, FormulaReference):
        return (formula.name,)
    if isinstance(formula, FormulaLiteral):
        return ()
    children = (formula.left, formula.right) if isinstance(formula, FormulaBinary) else formula.args
    return tuple(dict.fromkeys(ref for child in children for ref in formula_references(child)))


def validate_derived_measures(
    measures: Mapping[str, Measure | DerivedMeasure], dimensions: Mapping[str, Dimension]
) -> None:
    visiting: set[str] = set()
    complete: set[str] = set()

    def formula_type(formula: Formula) -> None:
        if isinstance(formula, FormulaLiteral):
            if type(formula.value) not in (int, float) and formula.value is not None:
                raise ValueError("Derived formulas require numeric or null literals")
        elif isinstance(formula, FormulaBinary):
            formula_type(formula.left)
            formula_type(formula.right)
        elif isinstance(formula, FormulaCall):
            arities = {"nullIfZero": 1, "coalesce": 2, "round": 2, "floor": 1, "ceil": 1}
            if len(formula.args) != arities[formula.name]:
                raise ValueError("Invalid derived formula arity")
            for child in formula.args:
                formula_type(child)
            if formula.name == "round":
                decimals = formula.args[1]
                if not isinstance(decimals, FormulaLiteral) or type(decimals.value) is not int:
                    raise ValueError("round decimals must be an integer literal")

    def visit(name: str, depth: int = 0) -> None:
        if name in visiting or depth > 16:
            raise ValueError("Derived measure cycle or dependency depth limit exceeded")
        if name in complete:
            return
        definition = measures.get(name)
        if definition is None:
            raise ValueError("Derived formula references an unknown or non-local measure")
        if isinstance(definition, DerivedMeasure):
            visiting.add(name)
            formula_type(definition.formula)
            references = formula_references(definition.formula)
            if not references or isinstance(definition.formula, FormulaReference):
                raise ValueError("Derived measure requires a formula over local measures")
            for reference in references:
                visit(reference, depth + 1)
            visiting.remove(name)
        elif definition.aggregation in ("min", "max", "argMin", "argMax"):
            dimension = dimensions.get(definition.field)
            if dimension is None or dimension.field_type != "number":
                raise ValueError("Derived formula input must be a numeric measure")
        complete.add(name)

    for name, definition in measures.items():
        if isinstance(definition, DerivedMeasure):
            visit(name)


def derived_measure_node(name: str, measure: DerivedMeasure) -> dict[str, object]:
    return {
        "kind": "derived",
        "name": name,
        "uses": [
            {"alias": reference, "measure": reference}
            for reference in formula_references(measure.formula)
        ],
        "expression": expression_to_data(compile_formula(measure.formula)),
        **({"label": measure.label} if measure.label is not None else {}),
        **({"description": measure.description} if measure.description is not None else {}),
    }


def base_measure_names(measures: Mapping[str, Measure | DerivedMeasure]) -> tuple[str, ...]:
    return tuple(name for name, definition in measures.items() if isinstance(definition, Measure))
