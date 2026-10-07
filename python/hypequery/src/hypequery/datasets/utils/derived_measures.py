"""Derived-measure validation and portable representation."""

from __future__ import annotations

from collections.abc import Mapping

from hypequery.protocol.expression_models import expression_to_data

from ..derived_measures import DerivedMeasure
from ..dimensions import Dimension
from ..formulas import (
    Formula,
    FormulaBinary,
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
    # Memoize full dependency depth and expanded size, not just completion.
    complete: dict[str, tuple[int, int]] = {}

    def formula_stats(formula: Formula, depth: int = 0) -> tuple[int, int]:
        if depth > 16:
            raise ValueError("Derived formula depth limit exceeded")
        if isinstance(formula, FormulaReference):
            return visit(formula.name)
        if isinstance(formula, FormulaLiteral):
            if type(formula.value) not in (int, float) and formula.value is not None:
                raise ValueError("Derived formulas require numeric or null literals")
            return (0, 1)
        children: tuple[Formula, ...]
        if isinstance(formula, FormulaBinary):
            children = (formula.left, formula.right)
        else:
            arities = {"nullIfZero": 1, "coalesce": 2, "round": 2, "floor": 1, "ceil": 1}
            if len(formula.args) != arities[formula.name]:
                raise ValueError("Invalid derived formula arity")
            if formula.name == "round":
                decimals = formula.args[1]
                if not isinstance(decimals, FormulaLiteral) or type(decimals.value) is not int:
                    raise ValueError("round decimals must be an integer literal")
            children = formula.args
        stats = tuple(formula_stats(child, depth + 1) for child in children)
        nodes = 1 + sum(size for _, size in stats)
        if nodes > 4096:
            raise ValueError("Derived formula expansion limit exceeded")
        return max(level for level, _ in stats), nodes

    def visit(name: str) -> tuple[int, int]:
        if name in visiting:
            raise ValueError("Derived measure cycle or dependency depth limit exceeded")
        if name in complete:
            return complete[name]
        definition = measures.get(name)
        if definition is None:
            raise ValueError("Derived formula references an unknown or non-local measure")
        stats = (0, 1)
        if isinstance(definition, DerivedMeasure):
            # Bound recursion before descending into uncached dependencies.
            if len(visiting) >= 16:
                raise ValueError("Derived measure dependency depth limit exceeded")
            visiting.add(name)
            dependency_depth, nodes = formula_stats(definition.formula)
            if dependency_depth >= 16:
                raise ValueError("Derived measure dependency depth limit exceeded")
            references = formula_references(definition.formula)
            if not references or isinstance(definition.formula, FormulaReference):
                raise ValueError("Derived measure requires a formula over local measures")
            stats = (dependency_depth + 1, nodes)
            visiting.remove(name)
        elif definition.aggregation in ("min", "max", "argMin", "argMax"):
            dimension = dimensions.get(definition.field)
            if dimension is None or dimension.field_type != "number":
                raise ValueError("Derived formula input must be a numeric measure")
        complete[name] = stats
        return stats

    for name, definition in measures.items():
        if isinstance(definition, DerivedMeasure):
            visit(name)


def derived_measure_node(
    name: str, measure: DerivedMeasure, *, canonical_uses: bool = False
) -> dict[str, object]:
    references = formula_references(measure.formula)
    if canonical_uses:
        references = tuple(sorted(references))
    return {
        "kind": "derived",
        "name": name,
        "uses": [{"alias": reference, "measure": reference} for reference in references],
        "expression": expression_to_data(compile_formula(measure.formula)),
        **({"label": measure.label} if measure.label is not None else {}),
        **({"description": measure.description} if measure.description is not None else {}),
    }


def base_measure_names(measures: Mapping[str, Measure | DerivedMeasure]) -> tuple[str, ...]:
    return tuple(name for name, definition in measures.items() if isinstance(definition, Measure))
