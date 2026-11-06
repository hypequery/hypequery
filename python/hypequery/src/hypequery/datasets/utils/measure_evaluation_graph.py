"""The evaluation graph of a composite time-measure query (TypeScript's
`measure-evaluation-graph.ts`).

A shift changes the context its input is evaluated in; a formula combines
values within one context. So `shift(ytd)` evaluates the to-date window over
the shifted interval rather than shifting current to-date values, and
`shift(shift(x))` evaluates `x` in a context two shifts back.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from ..derived_measures import DerivedMeasure
from ..measures import Measure
from ..time_measures import MeasureTimeInterval, ShiftMeasure, WindowMeasure
from .derived_measures import formula_references

#: Shifts reset the derived-measure depth and expansion limits, and each
#: shifted parent gets its own child contexts, so a few dozen definitions can
#: fan out into thousands of contexts. Each context scans the source, so cap
#: the graph before any SQL is built. The context check runs on the way down,
#: which also bounds recursion.
MAX_EVALUATION_CONTEXTS = 64
MAX_EVALUATION_NODES = 1024


@dataclass(frozen=True, slots=True)
class EvaluationContext:
    """Context 0 is the output bucket; each other one shifts its parent."""

    id: int
    parent: int | None = None
    interval: MeasureTimeInterval | None = None


@dataclass(frozen=True, slots=True)
class EvaluationNode:
    """One value per output bucket: a base or window aggregate, or a formula."""

    id: int
    name: str
    context: int
    definition: Measure | WindowMeasure | DerivedMeasure
    #: A formula's references, by measure name, to the nodes holding them.
    inputs: Mapping[str, int] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class EvaluationGraph:
    contexts: tuple[EvaluationContext, ...]
    #: Dependencies before the nodes that read them.
    nodes: tuple[EvaluationNode, ...]
    #: Each selected measure's node.
    outputs: Mapping[str, int]


def build_measure_evaluation_graph(
    measures: Mapping[str, object], selected: Iterable[str]
) -> EvaluationGraph:
    contexts = [EvaluationContext(0)]
    nodes: list[EvaluationNode] = []
    memo: dict[tuple[int, str], int] = {}
    shifted_contexts: dict[tuple[int, int, str], int] = {}

    def visit(name: str, context: int) -> int:
        key = (context, name)
        if key in memo:
            return memo[key]
        definition = measures.get(name)
        if isinstance(definition, ShiftMeasure):
            interval = definition.interval
            context_key = (context, interval.amount, interval.unit)
            shifted = shifted_contexts.get(context_key)
            if shifted is None:
                if len(contexts) >= MAX_EVALUATION_CONTEXTS:
                    raise ValueError(
                        f"Query needs more than {MAX_EVALUATION_CONTEXTS} shifted contexts; "
                        "select fewer nested shifts."
                    )
                shifted = len(contexts)
                contexts.append(EvaluationContext(shifted, context, interval))
                shifted_contexts[context_key] = shifted
            memo[key] = visit(definition.measure, shifted)
            return memo[key]
        if not isinstance(definition, Measure | WindowMeasure | DerivedMeasure):
            raise ValueError(f'Measure "{name}" is not defined.')
        inputs = (
            {
                reference: visit(reference, context)
                for reference in formula_references(definition.formula)
            }
            if isinstance(definition, DerivedMeasure)
            else {}
        )
        if len(nodes) >= MAX_EVALUATION_NODES:
            raise ValueError(
                f"Query needs more than {MAX_EVALUATION_NODES} evaluated measures; "
                "select fewer nested shifts."
            )
        node = EvaluationNode(len(nodes), name, context, definition, inputs)
        nodes.append(node)
        memo[key] = node.id
        return node.id

    outputs = {name: visit(name, 0) for name in selected}
    return EvaluationGraph(tuple(contexts), tuple(nodes), outputs)


__all__ = [
    "MAX_EVALUATION_CONTEXTS",
    "MAX_EVALUATION_NODES",
    "EvaluationContext",
    "EvaluationGraph",
    "EvaluationNode",
    "build_measure_evaluation_graph",
]
