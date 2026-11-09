"""Measure selections: base aggregates, relationship aggregates and formulas."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ...derived_measures import DerivedMeasure
from ...formulas import Formula
from ...measures import Measure
from ...utils.relationship_measures import measure_filter_field
from ..aggregates import AggregateCall
from ..errors import CompiledQueryError
from ..formula_sql import formula_sql
from ..identifiers import SafeIdentifier, safe_identifier
from ..resolution import is_qualified, physical_column, resolve_relationship_measure
from ..sql_fragments import aliased, trusted_expression
from .base import CompilerFeature

if TYPE_CHECKING:
    from ..compiler import DatasetQueryCompiler


class MeasureFeature(CompilerFeature):
    """Selects each measure and keeps its aggregate SQL for having conditions."""

    __slots__ = ("measure_sql",)

    def __init__(self, compiler: DatasetQueryCompiler) -> None:
        super().__init__(compiler)
        # Each selected measure's aggregate, so a having condition reads the
        # expression itself rather than an output alias.
        self.measure_sql: dict[str, str] = {}

    def add(self) -> None:
        compiler = self.compiler
        dataset = compiler.dataset
        for name in compiler.selected_measures:
            if is_qualified(name):
                self.measure_sql[name] = self._relationship_measure_sql(name)
            elif name not in dataset.measures:
                known = ", ".join(sorted(dataset.measures)) or "(none)"
                raise CompiledQueryError(
                    "input-invalid",
                    f'Unknown measure "{name}" on dataset "{dataset.name}". Available: {known}',
                )
            else:
                self.measure_sql[name] = self._local_measure_sql(name)
            alias = SafeIdentifier(name)
            compiler.node.selections.append(aliased(self.measure_sql[name], alias))
            compiler.orderable[name] = alias

    def _aggregation(self, name: str, measure: Measure) -> AggregateCall:
        """The aggregate call for one measure, over its field or its trusted SQL."""

        compiler = self.compiler
        if measure.sql is not None:
            if compiler.joins_active:
                raise CompiledQueryError(
                    "input-invalid",
                    f'SQL-backed measure "{name}" cannot be combined with relationship joins.',
                )
            target = trusted_expression(measure.sql)
        else:
            target = compiler.fields.base_column(measure.field)
        arg = None if measure.arg_field is None else compiler.fields.base_column(measure.arg_field)
        return compiler.dialect.aggregate(name, measure, target, arg)

    def _with_conditions(self, aggregate: AggregateCall, predicates: list[str]) -> str:
        """Apply a measure's own filters as a conditional aggregate.

        A measure filter narrows that one measure; putting it in WHERE would narrow
        every other measure in the same statement too.
        """

        if not predicates:
            return aggregate.sql
        return self.compiler.dialect.conditional(aggregate, " AND ".join(predicates)).sql

    def _base_measure_sql(self, name: str, measure: Measure) -> str:
        aggregate = self._aggregation(name, measure)
        predicate = self.compiler.filtering.predicate
        return self._with_conditions(aggregate, [predicate(item) for item in measure.filters or ()])

    def _relationship_measure_sql(self, name: str) -> str:
        """A target base aggregate over matched joined rows only.

        Every input is guarded by the match marker, so an unmatched base row
        keeps its own measures but contributes nothing to the target aggregate.
        The target measure's fixed filters narrow target columns, and the join
        carries the target's tenant predicate.
        """

        compiler = self.compiler
        resolved = resolve_relationship_measure(compiler.dataset, name, registry=compiler.registry)
        target = resolved.target
        alias = compiler.joins.ensure(resolved.relationship_name, resolved.relationship, target)
        marker = compiler.joins.match_markers[resolved.relationship_name]
        dialect = compiler.dialect
        matched = dialect.not_null(f"{alias.sql}.{marker.sql}")

        def guarded(field: str) -> str:
            column = safe_identifier(physical_column(target, field), what="column").sql
            return dialect.when(matched, f"{alias.sql}.{column}")

        measure = resolved.measure
        arg = guarded(measure.arg_field) if measure.arg_field is not None else None
        aggregate = dialect.aggregate(name, measure, guarded(measure.field), arg)
        predicates = [
            compiler.filtering.predicate(
                filter_value.with_field(
                    f"{resolved.relationship_name}."
                    f"{measure_filter_field(target, filter_value.field)}"
                )
            )
            for filter_value in measure.filters or ()
        ]
        return self._with_conditions(aggregate, predicates)

    def _local_measure_sql(self, name: str) -> str:
        """A local measure's SQL, compiled once however many formulas read it."""

        if name not in self.measure_sql:
            measure = self.compiler.dataset.measures[name]
            if isinstance(measure, DerivedMeasure):
                self.measure_sql[name] = self._formula_sql(measure.formula)
            elif isinstance(measure, Measure):
                self.measure_sql[name] = self._base_measure_sql(name, measure)
            else:
                # The planner routes window and shift queries to the time-measure
                # statement; reaching here is a planner fault, not caller input.
                raise CompiledQueryError(
                    "internal", f'Measure "{name}" needs the time-measure planner.'
                )
        return self.measure_sql[name]

    def _formula_sql(self, formula: Formula) -> str:
        compiler = self.compiler
        return formula_sql(formula, self._local_measure_sql, compiler.binder, compiler.dialect)
