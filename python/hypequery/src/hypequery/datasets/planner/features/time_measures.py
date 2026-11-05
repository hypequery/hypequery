"""Window and shift measures: a CTE statement over a bounded, gap-filled time axis.

Ports TypeScript's time-measure planner (`time-measure-dataset-sql.ts` and its
helpers) onto this compiler's features: the source rows are planned by the
same field, join and filtering features a grouped query uses, so tenancy,
resolved rows, segments and joins apply unchanged. The statement shape:

    _hq_raw      the dataset rows, every input packed into one tuple
    _hq_source   unpacked: time in the query zone, dimensions, measure inputs
    _hq_bounds   the caller's bounds and the first and last output buckets
    _hq_series   one row per output bucket, guarded against invalid axes
    _hq_scanned  only the source rows some output bucket reads
    _hq_skeleton every bucket for every dimension combination
    _hq_fanN     each source row in each bucket its window contributes to
    _hq_aggN     the base measure re-aggregated per bucket
    _hq_values   the skeleton with every measure joined on
    _hq_result   values, plus a guard branch that always validates the axis

A statement validates its own axis: the guard branch runs even when no rows
match, so no separate preflight statement is needed (TypeScript also runs one
first, which only fails faster).
"""

from __future__ import annotations

from dataclasses import dataclass

from ...derived_measures import DerivedMeasure
from ...formulas import Formula
from ...measures import Measure
from ...time_measures import ShiftMeasure, WindowMeasure
from ...utils.derived_measures import formula_references
from ...utils.time_axis import TimeAxis, analyze_time_axis, calendar_shift_at_fine_grain
from ..aliases import BASE_ALIAS, PERIOD_ALIAS
from ..context import TenantScope
from ..errors import CompiledQueryError
from ..formula_sql import formula_sql
from ..identifiers import SafeIdentifier, safe_qualified_identifier
from ..resolution import is_qualified, require_dimension, resolve_qualified_field
from ..sql_fragments import trusted_expression
from .base import CompilerFeature

_COUNTS = ("count", "countDistinct", "approxCountDistinct")
_COUNT_STATES = frozenset(
    ("uniq", "uniqExact", "uniqCombined", "uniqCombined64", "uniqHLL12", "uniqTheta", "count")
)
_SUB_DAY = ("minute", "hour")
_RANGE_ERROR = "Window measure time range must be non-empty and ordered."
_CALENDAR_ERROR = (
    "Time range crosses a skipped local calendar bucket; use a UTC time key for this range."
)
_FANOUT_ERROR = "A window row contributes to more than 1000 buckets."


@dataclass(frozen=True, slots=True)
class _Base:
    name: str
    measure: Measure
    #: The `_hq_source` columns holding the measure's input and its arg field.
    column: str
    arg: str


@dataclass(frozen=True, slots=True)
class _Input:
    name: str
    base: _Base
    window: WindowMeasure | None
    rows_sql: str
    restrict_to_axis: bool = True


@dataclass(frozen=True, slots=True)
class _Shift:
    ctes: list[str]
    rows_sql: str
    source_times_sql: str


def _is_count(measure: Measure) -> bool:
    return measure.aggregation in _COUNTS or (
        measure.aggregation == "merge" and measure.state_function in _COUNT_STATES
    )


class TimeMeasureFeature(CompilerFeature):
    """Plans a query that selects a window or shift measure, directly or in a formula."""

    __slots__ = ()

    # -- selection ---------------------------------------------------------

    def selected(self) -> list[tuple[str, WindowMeasure | ShiftMeasure]]:
        """Time measures the query reads, directly or through a derived formula."""

        measures = self.compiler.dataset.measures
        found: dict[str, WindowMeasure | ShiftMeasure] = {}
        pending = list(self.compiler.query.measures or ())
        seen: set[str] = set()
        while pending:
            name = pending.pop(0)
            if name in seen:
                continue
            seen.add(name)
            definition = measures.get(name)
            if isinstance(definition, WindowMeasure | ShiftMeasure):
                found[name] = definition
            elif isinstance(definition, DerivedMeasure):
                pending.extend(formula_references(definition.formula))
        return list(found.items())

    def _needed(self) -> list[str]:
        """Selected non-derived measures, then every derived measure's inputs."""

        measures = self.compiler.dataset.measures
        selected = list(self.compiler.query.measures or ())
        needed = [name for name in selected if not isinstance(measures.get(name), DerivedMeasure)]
        for name in selected:
            definition = measures.get(name)
            if not isinstance(definition, DerivedMeasure):
                continue
            for reference in formula_references(definition.formula):
                if isinstance(measures.get(reference), DerivedMeasure):
                    raise CompiledQueryError(
                        "input-invalid",
                        f'Derived measure "{name}" reads derived measure "{reference}": nested '
                        "formulas over window or shift measures are not supported in Python "
                        "yet. Reference the window, shift or base measures directly.",
                    )
                needed.append(reference)
        return list(dict.fromkeys(needed))

    # -- validation --------------------------------------------------------

    def _axis(self, selected: list[tuple[str, WindowMeasure | ShiftMeasure]]) -> TimeAxis:
        compiler = self.compiler
        dataset, query = compiler.dataset, compiler.query
        if query.having:
            raise CompiledQueryError(
                "input-invalid",
                "Having is not supported on queries that select window or shift measures.",
            )
        for name in query.measures or ():
            if is_qualified(name):
                raise CompiledQueryError(
                    "input-invalid",
                    f'Measure "{name}" crosses a relationship, which window and shift queries '
                    "do not support in Python yet.",
                )
        limit = query.limit
        if limit is None and dataset.limits is not None:
            limit = dataset.limits.max_result_size
        axis, errors = analyze_time_axis(
            dataset, selected, grain=query.by, filters=query.filters, result_limit=limit
        )
        if errors or axis is None:
            raise CompiledQueryError("input-invalid", " ".join(errors))
        return axis

    # -- statement ---------------------------------------------------------

    def compile(self, scope: TenantScope | None) -> str:
        compiler = self.compiler
        dialect, dataset = compiler.dialect, compiler.dataset
        chosen = self.selected()
        axis = self._axis(chosen)
        windows = {name: d for name, d in chosen if isinstance(d, WindowMeasure)}
        shifts = {name: d for name, d in chosen if isinstance(d, ShiftMeasure)}
        needed = self._needed()
        time_measures: dict[str, WindowMeasure | ShiftMeasure] = {**windows, **shifts}
        base_names = list(
            dict.fromkeys(time_measures[n].measure if n in time_measures else n for n in needed)
        )

        dimensions, bases, source_ctes, row_alias = self._source(axis, base_names, scope)
        axis_ctes, axis_guard, range_guard, post_series_guard = self._axis_ctes(
            axis, row_alias, list(shifts.values())
        )

        shifted: dict[str, _Shift] = {}
        for index, name in enumerate(needed):
            if name in shifts:
                shifted[name] = self._shift_ctes(shifts[name], axis, index)

        grain = axis.grain
        end = dialect.add_time("_hq_last", 1, grain)
        populations: list[str] = []
        if any(isinstance(dataset.measures.get(name), Measure) for name in needed):
            populations.append(f"(_hq_time >= _hq_first AND _hq_time < {end})")
        if windows:
            starts = [self._scan_start(w, grain) for w in windows.values() if not w.cumulative]
            lower = (
                ""
                if any(w.cumulative for w in windows.values())
                else f" AND _hq_time >= {dialect.least(*starts)}"
            )
            populations.append(f"(_hq_time < {end}{lower})")
        populations.extend(
            f"(_hq_time IN ({shift.source_times_sql}))" for shift in shifted.values()
        )
        scan = (
            "_hq_scanned AS (SELECT * FROM _hq_source CROSS JOIN _hq_bounds WHERE "  # noqa: S608
            + " OR ".join(populations)
            + ")"
        )

        inputs: list[_Input] = []
        for name in needed:
            definition = time_measures.get(name)
            base_name = definition.measure if definition is not None else name
            base = next(item for item in bases if item.name == base_name)
            if name in shifted:
                inputs.append(_Input(name, base, None, shifted[name].rows_sql, False))
                continue
            window = definition if isinstance(definition, WindowMeasure) else None
            inputs.append(_Input(name, base, window, self._window_rows(window, axis)))
        value_ctes = self._values(dimensions, inputs, axis)

        guard = f"{axis_guard} + {range_guard} + {post_series_guard}"
        ctes = [
            *source_ctes,
            *axis_ctes,
            *(cte for shift in shifted.values() for cte in shift.ctes),
            scan,
            *value_ctes,
        ]
        return self._result(dimensions, ctes, guard)

    def _source(
        self, axis: TimeAxis, base_names: list[str], scope: TenantScope | None
    ) -> tuple[list[tuple[str, str]], list[_Base], list[str], str]:
        """Plan the filtered dataset rows, with every input packed into one tuple."""

        compiler = self.compiler
        dialect, dataset, fields = compiler.dialect, compiler.dataset, compiler.fields
        time_key = dataset.time_key
        if time_key is None:
            raise CompiledQueryError("input-invalid", f'Dataset "{dataset.name}" has no time key.')
        parts = [fields.base_column(time_key)]
        dimensions: list[tuple[str, str]] = []
        for index, name in enumerate(compiler.query.dimensions):
            definition = (
                resolve_qualified_field(dataset, name, registry=compiler.registry).dimension
                if is_qualified(name)
                else require_dimension(dataset, name)
            )
            if definition.groupable is False:
                raise CompiledQueryError("input-invalid", f'Dimension "{name}" is not groupable.')
            dimensions.append((name, f"_hq_d{index}"))
            parts.append(fields.field_sql(name))
        bases: list[_Base] = []
        for name in base_names:
            measure = dataset.measures.get(name)
            if not isinstance(measure, Measure):
                raise CompiledQueryError(
                    "input-invalid", f'Window input "{name}" is not a base measure.'
                )
            index = len(bases)
            bases.append(_Base(name, measure, f"_hq_v{index}", f"_hq_a{index}"))
            parts.append(self._input_value(name, measure))
            parts.append(
                "NULL" if measure.arg_field is None else fields.base_column(measure.arg_field)
            )

        # A positional tuple keeps internal names apart from the source's own.
        identifiers = [
            *parts,
            *dataset.dimensions,
            *(d.sql or d.column or "" for d in dataset.dimensions.values()),
            *(f.field for f in dataset.filters.values()),
            dataset.tenant_key or "",
        ]
        row = "_hq_row"
        while any(row in text for text in identifiers):
            row += "_"
        node = compiler.node
        node.selections.append(f"{dialect.pack_row(parts)} AS {row}")
        compiler.filtering.add(scope, filters=axis.filters)
        node.source = safe_qualified_identifier(dataset.source, what="dataset source").sql
        node.base_alias = BASE_ALIAS
        node.resolved_source = dataset.row_resolution is not None
        raw = dialect.render_select(node)

        element = dialect.row_element
        columns = [f"{fields.time_sql(dialect.assume_not_null(element(row, 1)))} AS _hq_time"]
        for position, (_, alias) in enumerate(dimensions):
            columns.append(f"{element(row, position + 2)} AS {alias}")
        for position, base in enumerate(bases):
            start = len(dimensions) + 2 + position * 2
            columns.append(f"{element(row, start)} AS {base.column}")
            columns.append(f"{element(row, start + 1)} AS {base.arg}")
        source = (
            f"_hq_source AS (SELECT {', '.join(columns)} FROM _hq_raw "  # noqa: S608
            f"WHERE {compiler.dialect.not_null(element(row, 1))})"
        )
        return dimensions, bases, [f"_hq_raw AS ({raw})", source], row

    def _input_value(self, name: str, measure: Measure) -> str:
        """A base measure's input column, with its own filters folded in."""

        compiler = self.compiler
        if measure.sql is not None:
            if compiler.joins_active:
                raise CompiledQueryError(
                    "input-invalid",
                    f'SQL-backed measure "{name}" cannot be combined with relationship joins.',
                )
            column = trusted_expression(measure.sql)
        else:
            column = compiler.fields.base_column(measure.field)
        if not measure.filters:
            return column
        if measure.aggregation in ("argMax", "argMin"):
            raise CompiledQueryError(
                "input-invalid",
                f"Measure filters are not supported on {measure.aggregation} window inputs.",
            )
        condition = " AND ".join(
            f"({compiler.filtering.predicate(condition)})" for condition in measure.filters
        )
        # Aggregates skip NULLs, so NULL excludes rows; sum keeps a 0 instead.
        fallback = "0" if measure.aggregation == "sum" else "NULL"
        return compiler.dialect.filtered_input(condition, column, fallback)

    def _calendar_guard(self, start: str, count: str, grain: str) -> str:
        """Reject a local calendar that skips a bucket (TypeScript `calendarBucketGuardSql`)."""

        if grain in _SUB_DAY:
            return "0"
        dialect = self.compiler.dialect
        index = "_hq_calendar_index"
        current = dialect.add_time(start, index, grain)
        following = dialect.add_time(start, f"{index} + 1", grain)
        return dialect.guard(
            dialect.any_index(index, dialect.greatest("1", count), f"{following} <= {current}"),
            _CALENDAR_ERROR,
        )

    def _source_timezone(self) -> str:
        dialect = self.compiler.dialect
        return dialect.timezone_of(
            dialect.assume_not_null("(SELECT _hq_time FROM _hq_source LIMIT 0)")
        )

    def _axis_ctes(
        self, axis: TimeAxis, row: str, shifts: list[ShiftMeasure]
    ) -> tuple[list[str], str, str, str]:
        """`_hq_bounds` and the guarded `_hq_series` of output buckets."""

        compiler = self.compiler
        dialect, grain = compiler.dialect, axis.grain
        first = dialect.start_of("_hq_lower", grain)
        upper_bucket = dialect.start_of("_hq_upper", grain)
        last = (
            upper_bucket
            if axis.upper_inclusive
            else dialect.if_else(
                f"_hq_upper = {upper_bucket}",
                dialect.subtract_time(upper_bucket, 1, grain),
                upper_bucket,
            )
        )
        count = f"{dialect.time_diff(grain, '_hq_first', '_hq_last')} + 1"
        empty = "" if axis.lower_inclusive and axis.upper_inclusive else " OR _hq_lower = _hq_upper"
        range_guard = dialect.guard(f"_hq_lower > _hq_upper{empty}", _RANGE_ERROR)
        limit_guard = (
            "0"
            if axis.result_limit is None
            else dialect.guard(
                f"{count} > {axis.result_limit:d}",
                f"Window series exceeds the effective result limit of {axis.result_limit:d} "
                "buckets.",
            )
        )
        calendar_guard = self._calendar_guard(
            "_hq_first", f"{count} + {limit_guard} + {range_guard}", grain
        )
        # A zero-row scalar reads the column type without scanning the source.
        empty_row = f"(SELECT {row} FROM _hq_raw LIMIT 0)"  # noqa: S608 - internal aliases
        physical_time = dialect.row_element(empty_row, 1)
        physical_guard = (
            dialect.guard(
                dialect.is_date_only_type(physical_time),
                "Sub-day time measures require a time-of-day column; Date and Date32 are "
                "not supported.",
            )
            if grain in _SUB_DAY
            else "0"
        )
        shift_guards = [
            self._shift_calendar_guard(shift, axis, f"{limit_guard} + {range_guard}")
            for shift in shifts
        ]
        guard = " + ".join([limit_guard, physical_guard, calendar_guard, *shift_guards])
        post_series = " + ".join(self._shift_series_guard(shift, grain) for shift in shifts) or "0"
        timezone = self._source_timezone()
        binder = compiler.binder
        bounds = [
            # The bounds are the caller's: bound, never written into the text.
            f"{dialect.parse_timestamp(binder.bind(axis.lower, 'String'), timezone)} AS _hq_lower",
            f"{dialect.parse_timestamp(binder.bind(axis.upper, 'String'), timezone)} AS _hq_upper",
            f"{first} AS _hq_first",
            f"{last} AS _hq_last",
        ]
        period = dialect.add_time(
            "_hq_first", dialect.series_index(f"{count} + {guard} + {range_guard}"), grain
        )
        ctes = [
            f"_hq_bounds AS (SELECT {', '.join(bounds)})",
            f"_hq_series AS (SELECT {period} AS _hq_period FROM _hq_bounds)",  # noqa: S608
        ]
        return ctes, guard, range_guard, post_series

    # -- windows -----------------------------------------------------------

    def _scan_start(self, window: WindowMeasure, grain: str) -> str:
        dialect = self.compiler.dialect
        if window.trailing is not None:
            return dialect.subtract_time(
                dialect.add_time("_hq_first", 1, grain),
                window.trailing.amount,
                window.trailing.unit,
            )
        if window.to_date is not None:
            return dialect.start_of("_hq_first", window.to_date)
        raise CompiledQueryError("internal", "Cumulative windows have unbounded history.")

    def _contribution(self, window: WindowMeasure | None, grain: str) -> str:
        """Each source row in every output bucket its window contributes to."""

        dialect = self.compiler.dialect
        bucket = dialect.start_of("_hq_time", grain)
        if window is None:
            return bucket
        if window.cumulative:
            return dialect.greatest(bucket, "_hq_first")
        if window.trailing is not None:
            ending = dialect.add_time(bucket, window.trailing.amount, window.trailing.unit)
        elif window.to_date is not None:
            calendar_start = dialect.start_of("_hq_time", window.to_date)
            ending = dialect.add_time(calendar_start, 1, window.to_date)
        else:
            raise CompiledQueryError("internal", "Window measure has no supported mode.")
        count = dialect.time_diff(grain, bucket, ending)
        fanout = dialect.guard(f"{count} > 1000", _FANOUT_ERROR)
        calendar = self._calendar_guard(bucket, f"{count} + {fanout}", grain)
        return dialect.add_time(
            bucket, dialect.series_index(f"{count} + {fanout} + {calendar}"), grain
        )

    def _window_rows(self, window: WindowMeasure | None, axis: TimeAxis) -> str:
        """Base measures keep partial endpoints; windows read whole contributing buckets."""

        where = ""
        if window is None:
            lower = ">=" if axis.lower_inclusive else ">"
            upper = "<=" if axis.upper_inclusive else "<"
            where = f" WHERE _hq_time {lower} _hq_lower AND _hq_time {upper} _hq_upper"
        contribution = self._contribution(window, axis.grain)
        return f"SELECT *, {contribution} AS _hq_period FROM _hq_scanned{where}"  # noqa: S608

    def _values(
        self, dimensions: list[tuple[str, str]], inputs: list[_Input], axis: TimeAxis
    ) -> list[str]:
        """Fill dimension combinations, aggregate each input, and join it onto the series."""

        dialect = self.compiler.dialect
        keys = [alias for _, alias in dimensions]
        distinct = f"SELECT DISTINCT {', '.join(keys)} FROM _hq_scanned"  # noqa: S608
        combinations = f" CROSS JOIN ({distinct}) AS _hq_combinations" if keys else ""
        ctes = [f"_hq_skeleton AS (SELECT * FROM _hq_series{combinations})"]  # noqa: S608
        projections = [
            "s._hq_period AS period",
            *(f"s.{alias} AS {SafeIdentifier(name).sql}" for name, alias in dimensions),
        ]
        joins: list[str] = []
        group = "_hq_period" + (f", {', '.join(keys)}" if keys else "")
        for index, entry in enumerate(inputs):
            output, fan, aggregate = f"_hq_m{index}", f"_hq_fan{index}", f"_hq_agg{index}"
            ctes.append(f"{fan} AS ({entry.rows_sql})")
            # toNullable keeps an unmatched LEFT JOIN column NULL, whatever join_use_nulls is.
            expression = dialect.window_aggregate(
                entry.base.measure, entry.base.column, entry.base.arg
            )
            output_range = (
                " WHERE _hq_period BETWEEN _hq_first AND _hq_last" if entry.restrict_to_axis else ""
            )
            trailing = ""
            if entry.window is not None and entry.window.trailing is not None:
                start = dialect.subtract_time(
                    dialect.add_time("_hq_period", 1, axis.grain),
                    entry.window.trailing.amount,
                    entry.window.trailing.unit,
                )
                trailing = f" AND _hq_time >= {start}"
            ctes.append(
                f"{aggregate} AS (SELECT {group}, {dialect.to_nullable(expression)} AS {output} "  # noqa: S608
                f"FROM {fan}{output_range}{trailing} GROUP BY {group})"
            )
            alias = f"m{index}"
            condition = [
                f"s._hq_period = {alias}._hq_period",
                *(dialect.is_not_distinct_from(f"s.{key}", f"{alias}.{key}") for key in keys),
            ]
            joins.append(f"LEFT JOIN {aggregate} AS {alias} ON {' AND '.join(condition)}")
            column = f"{alias}.{output}"
            if entry.window is not None and entry.window.cumulative:
                aggregation = entry.base.measure.aggregation
                operation = "sum" if aggregation == "count" else aggregation
                partition = f"PARTITION BY {', '.join(f's.{k}' for k in keys)} " if keys else ""
                frame = (
                    f"{partition}ORDER BY s._hq_period "
                    "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW"
                )
                column = f"{dialect.reaggregate(operation, column)} OVER ({frame})"
            if _is_count(entry.base.measure):
                column = f"coalesce({column}, 0)"
            projections.append(f"{column} AS {SafeIdentifier(entry.name).sql}")
        ctes.append(
            f"_hq_values AS (SELECT {', '.join(projections)} FROM _hq_skeleton AS s "  # noqa: S608
            f"{' '.join(joins)})"
        )
        return ctes

    # -- shifts ------------------------------------------------------------

    def _shift_bound(self, point: str, anchor: str, shift: ShiftMeasure, grain: str) -> str:
        dialect = self.compiler.dialect
        interval = shift.interval
        if not calendar_shift_at_fine_grain(interval, grain):
            return dialect.subtract_time(point, interval.amount, interval.unit)
        # Anchored: the point keeps its day offset within its shifted bucket.
        shifted_point = dialect.subtract_time(point, interval.amount, interval.unit)
        shifted_anchor = dialect.subtract_time(anchor, interval.amount, interval.unit)
        days = (
            f"{dialect.time_diff('day', shifted_point, shifted_anchor)} + "
            f"{dialect.time_diff('day', anchor, point)}"
        )
        return dialect.add_time(shifted_point, days, "day")

    def _shift_range(
        self, shift: ShiftMeasure, axis: TimeAxis, period: str | None = None
    ) -> tuple[str, str, str, str]:
        """The earlier range a bucket reads: lower, upper and their inclusivity."""

        dialect, grain = self.compiler.dialect, axis.grain
        first = period or "_hq_first"
        last = period or "_hq_last"
        end = dialect.add_time(last, 1, grain)
        upper = self._shift_bound(dialect.least(end, "_hq_upper"), last, shift, grain)
        if calendar_shift_at_fine_grain(shift.interval, grain):
            shifted_end = dialect.add_time(
                dialect.subtract_time(last, shift.interval.amount, shift.interval.unit), 1, grain
            )
            upper = dialect.if_else(f"_hq_upper >= {end}", shifted_end, upper)
        lower = self._shift_bound(dialect.greatest(first, "_hq_lower"), first, shift, grain)
        lower_inclusive = (
            f"({period} > _hq_lower OR {int(axis.lower_inclusive)})"
            if period
            else str(int(axis.lower_inclusive))
        )
        upper_inclusive = f"(_hq_upper < {end} AND {int(axis.upper_inclusive)})"
        return lower, upper, lower_inclusive, upper_inclusive

    @staticmethod
    def _range_predicate(time: str, lower: str, upper: str, lower_in: str, upper_in: str) -> str:
        return (
            f"({time} > {lower} OR ({lower_in} AND {time} = {lower}))"
            f" AND ({time} < {upper} OR ({upper_in} AND {time} = {upper}))"
        )

    def _shift_calendar_guard(self, shift: ShiftMeasure, axis: TimeAxis, axis_guard: str) -> str:
        dialect, grain = self.compiler.dialect, axis.grain
        lower, upper, _, _ = self._shift_range(shift, axis)
        first, last = dialect.start_of(lower, grain), dialect.start_of(upper, grain)
        return self._calendar_guard(
            first, f"{dialect.time_diff(grain, first, last)} + {axis_guard}", grain
        )

    def _shift_series_guard(self, shift: ShiftMeasure, grain: str) -> str:
        """Reject DST normalization that moves a shifted sub-day bucket's wall time."""

        if not calendar_shift_at_fine_grain(shift.interval, grain) or grain not in _SUB_DAY:
            return "0"
        dialect = self.compiler.dialect
        interval = shift.interval
        end = dialect.add_time("_hq_period", 1, grain)
        period, lower, upper = (
            "_hq_period",
            dialect.greatest("_hq_period", "_hq_lower"),
            dialect.least(end, "_hq_upper"),
        )

        def changes(point: str) -> str:
            moved = dialect.subtract_time(point, interval.amount, interval.unit)
            return " OR ".join(
                f"{dialect.clock_part(part, point)} != {dialect.clock_part(part, moved)}"
                for part in ("Hour", "Minute", "Second")
            )

        changed = (
            f"({changes(period)}) OR ({changes(lower)})"
            f" OR ({upper} != {end} AND ({changes(upper)}))"
        )
        guard = dialect.guard(
            f"{dialect.count_if(changed)} > 0",
            "Calendar shift lands on a nonexistent local time; use a UTC query timezone.",
        )
        return f"(SELECT {guard} FROM _hq_series CROSS JOIN _hq_bounds)"  # noqa: S608

    def _shift_ctes(self, shift: ShiftMeasure, axis: TimeAxis, index: int) -> _Shift:
        """Map each output bucket to its earlier range, keeping duplicate source rows."""

        dialect, grain = self.compiler.dialect, axis.grain
        ranges, keys = f"_hq_shift_ranges{index}", f"_hq_shift_keys{index}"
        lower, upper, lower_in, upper_in = self._shift_range(shift, axis, "_hq_period")
        bucket = dialect.start_of("_hq_shift_lower", grain)
        upper_bucket = dialect.start_of("_hq_shift_upper", grain)
        partial = dialect.if_else(
            f"_hq_shift_upper > {upper_bucket} OR _hq_shift_upper_inclusive", "1", "0"
        )
        count = dialect.greatest(
            "0", f"{dialect.time_diff(grain, bucket, upper_bucket)} + {partial}"
        )
        predicate = self._range_predicate(
            "r._hq_time",
            "b._hq_shift_lower",
            "b._hq_shift_upper",
            "b._hq_shift_lower_inclusive",
            "b._hq_shift_upper_inclusive",
        )
        join = (
            f" AS r INNER JOIN {keys} AS b ON {dialect.start_of('r._hq_time', grain)} = "
            f"b._hq_source_period WHERE {predicate}"
        )
        return _Shift(
            ctes=[
                f"{ranges} AS (SELECT _hq_period, {lower} AS _hq_shift_lower, "  # noqa: S608
                f"{upper} AS _hq_shift_upper, {lower_in} AS _hq_shift_lower_inclusive, "
                f"{upper_in} AS _hq_shift_upper_inclusive FROM _hq_series CROSS JOIN _hq_bounds)",
                # A DST change can map one output hour to zero or two source hours:
                # enumerate source bucket keys and keep the exact endpoints.
                f"{keys} AS (SELECT *, "  # noqa: S608 - internal aliases and planner SQL
                f"{dialect.add_time(bucket, dialect.series_index(count), grain)} "
                f"AS _hq_source_period FROM {ranges})",
            ],
            rows_sql=f"SELECT r.*, b._hq_period FROM _hq_scanned{join}",  # noqa: S608
            source_times_sql=f"SELECT r._hq_time FROM _hq_source{join}",  # noqa: S608
        )

    # -- result ------------------------------------------------------------

    def _formula(self, formula: Formula) -> str:
        """A derived measure over `_hq_values` columns, evaluated after aggregation."""

        compiler = self.compiler
        return formula_sql(
            formula, lambda name: SafeIdentifier(name).sql, compiler.binder, compiler.dialect
        )

    def _result(self, dimensions: list[tuple[str, str]], ctes: list[str], guard: str) -> str:
        compiler = self.compiler
        dialect, dataset, query = compiler.dialect, compiler.dataset, compiler.query
        selected = list(query.measures or ())
        period = PERIOD_ALIAS.sql
        projections = [period, *(SafeIdentifier(name).sql for name, _ in dimensions)]
        for name in selected:
            definition = dataset.measures.get(name)
            if isinstance(definition, DerivedMeasure):
                projections.append(
                    f"{self._formula(definition.formula)} AS {SafeIdentifier(name).sql}"
                )
            else:
                projections.append(SafeIdentifier(name).sql)
        outputs = [PERIOD_ALIAS.name, *(name for name, _ in dimensions), *selected]
        nulls = ", ".join(f"NULL AS {SafeIdentifier(name).sql}" for name in outputs)
        # The guard branch returns no rows, but forces axis validation even when
        # no source row matched.
        result = (
            f"_hq_result AS (SELECT {', '.join(projections)} FROM _hq_values "  # noqa: S608
            f"UNION ALL SELECT {nulls} FROM _hq_bounds WHERE {guard} = 1)"
        )
        orderable = set(outputs)
        order: list[str] = []
        for term in query.order_by:
            if term.field not in orderable:
                raise CompiledQueryError(
                    "input-invalid",
                    f'Cannot order by "{term.field}" because it is not selected. '
                    f"Available: {', '.join(sorted(orderable))}",
                )
            # The bucket orders by instant; only the selected period is text.
            column = (
                f"_hq_result.{period}"
                if term.field == PERIOD_ALIAS.name
                else SafeIdentifier(term.field).sql
            )
            order.append(f"{column} {'ASC' if term.direction == 'asc' else 'DESC'}")
        if not order:
            order.append(f"_hq_result.{period} ASC")
        final = [
            f"{dialect.period_text(f'_hq_result.{period}')} AS {period}",
            *(SafeIdentifier(name).sql for name in outputs[1:]),
        ]
        compiler.ordering.paginate()
        node = compiler.node
        select = f"SELECT {', '.join(final)} FROM _hq_result"  # noqa: S608 - internal aliases
        sql = "WITH " + ",\n".join([*ctes, result]) + f" {select} ORDER BY {', '.join(order)}"
        if node.limit is not None:
            sql += f" LIMIT {node.limit:d}"
        if node.offset is not None:
            sql += f" OFFSET {node.offset:d}"
        if node.resolved_source or compiler.joins.reads_resolved_rows:
            sql += f" SETTINGS {dialect.resolved_rows_settings()}"
        return sql


__all__ = ["TimeMeasureFeature"]
