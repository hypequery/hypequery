"""The subset of derived-measure formulas a deployment contract accepts.

Local planning accepts every formula the authoring helpers can build. The
RFC 0006 deployment grammar is narrower: a derived measure may reference only
base measures, and a literal may appear only as ``round`` decimals or as a
``coalesce`` fallback. Checking that subset against the definition, rather than
the emitted contract, lets the failure name the dataset and measure instead of
a JSON path.
"""

from __future__ import annotations

from collections.abc import Mapping

from ..derived_measures import DerivedMeasure
from ..formulas import Formula, FormulaBinary, FormulaCall, FormulaLiteral, FormulaReference
from ..measures import Measure

_LITERAL_POSITIONS = "literals are only accepted as round decimals or a coalesce fallback"


def deployable_formula_issue(
    formula: Formula, measures: Mapping[str, Measure | DerivedMeasure]
) -> str | None:
    """Why *formula* cannot be deployed, or ``None`` when it can.

    *measures* are the measures of the dataset that owns the formula. The
    dataset has already validated references, arity and cycles, so only the
    deployment-specific restrictions are reported here.
    """

    if isinstance(formula, FormulaReference):
        if isinstance(measures.get(formula.name), DerivedMeasure):
            return (
                f'references derived measure "{formula.name}"; a deployable formula may only '
                "reference base measures, so inline that formula or reference the base "
                "measures directly"
            )
        return None
    if isinstance(formula, FormulaLiteral):
        return f"a literal cannot be a deployable formula on its own; {_LITERAL_POSITIONS}"
    if isinstance(formula, FormulaBinary):
        for operand in (formula.left, formula.right):
            if isinstance(operand, FormulaLiteral):
                return (
                    "a numeric literal cannot be an arithmetic operand in a deployable "
                    f"formula; {_LITERAL_POSITIONS}"
                )
            issue = deployable_formula_issue(operand, measures)
            if issue is not None:
                return issue
        return None
    return _call_issue(formula, measures)


def _call_issue(
    formula: FormulaCall, measures: Mapping[str, Measure | DerivedMeasure]
) -> str | None:
    first = formula.args[0]
    if isinstance(first, FormulaLiteral):
        return (
            f"a literal cannot be the value passed to {formula.name} in a deployable "
            f"formula; {_LITERAL_POSITIONS}"
        )
    issue = deployable_formula_issue(first, measures)
    if issue is not None:
        return issue
    if formula.name == "round":
        # Dataset validation already requires an integer literal here.
        return None
    if formula.name == "coalesce":
        fallback = formula.args[1]
        if isinstance(fallback, FormulaLiteral):
            if type(fallback.value) not in (int, float):
                return (
                    "a coalesce fallback must be a number in a deployable formula; "
                    "None and booleans are not accepted"
                )
            return None
        return deployable_formula_issue(fallback, measures)
    return None


def deployable_measure_issues(
    measures: Mapping[str, Measure | DerivedMeasure],
) -> list[tuple[str, str]]:
    """Every ``(measure name, issue)`` pair among *measures*, in definition order."""

    issues: list[tuple[str, str]] = []
    for name, definition in measures.items():
        if not isinstance(definition, DerivedMeasure):
            continue
        issue = deployable_formula_issue(definition.formula, measures)
        if issue is not None:
            issues.append((name, issue))
    return issues
