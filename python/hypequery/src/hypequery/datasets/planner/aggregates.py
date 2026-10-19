"""Aggregate calls as structure rather than rendered text.

A measure filter turns `sum(x)` into `sumIf(x, condition)`, and a parametric
aggregate such as `quantile(0.9)(x)` into `quantileIf(0.9)(x, condition)`.
Building that from the parts is exact; rewriting rendered SQL by splitting on
the first parenthesis only works while no argument contains one.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AggregateCall:
    """`function(parameters)(arguments)`, with already-safe SQL operands."""

    function: str
    arguments: tuple[str, ...]
    #: ClickHouse parametric-aggregate parameters, e.g. a quantile level.
    parameters: tuple[str, ...] = ()

    def with_condition(self, condition: str) -> AggregateCall:
        """The same aggregate over only the rows *condition* holds for (`-If`)."""

        return AggregateCall(f"{self.function}If", (*self.arguments, condition), self.parameters)

    @property
    def sql(self) -> str:
        parameters = f"({', '.join(self.parameters)})" if self.parameters else ""
        return f"{self.function}{parameters}({', '.join(self.arguments)})"
