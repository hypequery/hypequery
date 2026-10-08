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


#: Per-formula limits, matching TypeScript's derived-measure validation.
MAX_FORMULA_NODES = 256
# ClickHouse's own inference for inline integer literals, narrowest first.
_INTEGER_TYPES = (
    ("UInt8", range(0, 2**8)),
    ("UInt16", range(0, 2**16)),
    ("UInt32", range(0, 2**32)),
    ("UInt64", range(0, 2**64)),
    ("Int8", range(-(2**7), 0)),
    ("Int16", range(-(2**15), 0)),
    ("Int32", range(-(2**31), 0)),
    ("Int64", range(-(2**63), 0)),
)


def formula_node_count(formula: Formula) -> int:
    """Nodes in one formula, before expanding references to other measures."""
    pending = [formula]
    count = 0
    while pending:
        node = pending.pop()
        count += 1
        if isinstance(node, FormulaBinary):
            pending.extend((node.left, node.right))
        elif not isinstance(node, (FormulaReference, FormulaLiteral)):
            pending.extend(node.args)
    return count


def literal_parameter_type(value: bool | int | float) -> str:
    """The ClickHouse type a numeric formula literal binds as.

    TypeScript writes literals inline, and ClickHouse types an inline integer as
    the narrowest type that holds it (``0`` is ``UInt8``). Matching that keeps
    integer arithmetic integral and lets ``coalesce(ratio, 0)`` stay ``Float64``:
    ClickHouse has no common type for ``Float64`` and ``Int64`` (25.x refuses it;
    26.x returns a ``Variant``), but does for the narrower integers.
    """
    if type(value) is int:
        for clickhouse_type, values in _INTEGER_TYPES:
            if value in values:
                return clickhouse_type
    return "Float64"


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
            if formula_node_count(definition.formula) > MAX_FORMULA_NODES:
                raise ValueError("Derived formula exceeds the expression limits")
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
