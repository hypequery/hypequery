/**
 * Plans RFC 0026 query-scoped calculations.
 *
 * `filter`, `shift`, `window` and `formula` entries (and `compare`, which
 * expands into a shift and two formulas per measure) become measures of a
 * query-scoped view of the dataset, under reserved internal names. The
 * existing planners then compile the view exactly as they compile model-level
 * filtered, shift, window and derived measures, so every constraint they
 * enforce applies unchanged. The caller-facing names, `having`, ordering and
 * pagination are applied by an outer stage over the planned statement.
 */

import { ProtocolExpressionError, validateProtocolSemanticQuery } from '@hypequery/protocol';
import type {
  AnyDatasetInstance,
  DatasetHavingCondition,
  DatasetMeasureDefinition,
  DatasetQuery,
  ExecutionContext,
  MeasureDefinition,
  MetricOrderBy,
  ShiftMeasureDefinition,
  WindowMeasureDefinition,
} from '../types.js';
import { baseMeasureNames, derivedMeasuresView, getBaseMeasure, isShiftMeasure, isWindowMeasure } from './dataset-measures.js';
import { validateShiftMeasures } from './shift-measure-validation.js';
import { validateWindowMeasures } from './window-measure-validation.js';
import { queryFilterErrors } from './query-filter-errors.js';
import { effectiveFilters } from './effective-filters.js';
import { datasetHavingErrors } from './dataset-having.js';
import { measureDependencyNames } from './measure-dependencies.js';
import { formulaMeasure, formulaReferences } from './query-calculation-formula.js';
import {
  CALCULATION_INTERNAL_PREFIX,
  calculationKind,
  calculationOutputs,
  type CalculationOutput,
} from './query-calculation-outputs.js';
import type { DatasetQueryCalculation, QueryCalculationKind } from './query-calculation-types.js';

/** Base aggregations a filter calculation cannot condition, as for model-level filtered measures. */
const UNFILTERABLE = new Set(['argMax', 'argMin', 'merge']);
/** Kinds this release plans; the rest are refused by name until they are implemented. */
const PLANNED_KINDS: ReadonlySet<QueryCalculationKind> = new Set(['filter', 'shift', 'window', 'formula', 'compare']);

export interface QueryCalculationPlan {
  /** The dataset with every calculation measure added under its internal name. */
  readonly dataset: AnyDatasetInstance;
  /** What the inner planners compile: no calculations, `having`, order or page. */
  readonly inner: DatasetQuery;
  readonly selectedMeasures: readonly string[];
  readonly outputs: readonly CalculationOutput[];
  readonly having: readonly DatasetHavingCondition[];
  readonly orderBy: readonly MetricOrderBy[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface QueryCalculationPlanResult {
  readonly plan?: QueryCalculationPlan;
  readonly errors: readonly string[];
  /** Kinds or fields this executor recognises but cannot run yet. */
  readonly unsupported: readonly string[];
}

/** An earlier entry's output, as a later entry may read it. */
interface Available {
  readonly internal: string;
  readonly kind: QueryCalculationKind;
  /** Depends on a shift or window. */
  readonly timed: boolean;
}

function entryLabel(entry: DatasetQueryCalculation, index: number): string {
  return `Calculation "${String(entry.name)}" (calculations[${index}])`;
}

/** The structural rules RFC 0026 makes decidable from the query, via the protocol validator. */
function envelopeErrors(query: DatasetQuery): string[] {
  const probe = {
    kind: 'dataset',
    dataset: 'dataset',
    ...(query.dimensions === undefined ? {} : { dimensions: query.dimensions }),
    ...(query.measures === undefined ? {} : { measures: query.measures }),
    ...(query.by === undefined ? {} : { by: 'day' }),
    ...(query.orderBy === undefined
      ? {}
      : { orderBy: query.orderBy.map(order => ({ field: order.field, direction: 'asc' })) }),
    ...(query.calculations === undefined ? {} : {
      calculations: query.calculations.map(entry => (
        entry !== null && typeof entry === 'object' && 'filter' in entry
          && entry.filter !== null && typeof entry.filter === 'object' && Array.isArray(entry.filter.where)
          ? {
              ...entry,
              filter: {
                ...entry.filter,
                // Values are checked against each field's type below; the
                // envelope only needs the shape and the field name.
                where: entry.filter.where.map(filter => ({
                  kind: 'comparison', operator: 'isNull', left: { kind: 'reference', name: filter?.field },
                })),
              },
            }
          : entry
      )),
    }),
    ...(query.limitBy === undefined ? {} : { limitBy: query.limitBy }),
    ...(query.other === undefined ? {} : { other: query.other }),
  };
  try {
    validateProtocolSemanticQuery(probe, { extension: 2 });
    return [];
  } catch (error) {
    if (error instanceof ProtocolExpressionError) {
      return [`Invalid query calculations at ${error.path} (${error.code})${envelopeHint(error.path, query)}.`];
    }
    throw error;
  }
}

/** A plain-language reason for the envelope failures a caller most often hits. */
function envelopeHint(path: string, query: DatasetQuery): string {
  if (query.by === undefined && /^\$\.calculations\[\d+\]\.(shift|window|compare)$/.test(path)) {
    return ': shift, window and compare calculations require "by"';
  }
  if (path === '$.limitBy' && (query.orderBy?.length ?? 0) === 0) return ': limitBy requires a non-empty orderBy';
  if (/\.(measure|args\[\d+\]|measures\[\d+\])$/.test(path)) {
    return ': the input must be a selected measure or an earlier calculation of a kind this one accepts';
  }
  return '';
}

class CalculationPlanner {
  readonly errors: string[] = [];
  readonly unsupported: string[] = [];
  private readonly available = new Map<string, Available>();
  private readonly added: Record<string, DatasetMeasureDefinition> = {};

  constructor(
    private readonly ds: AnyDatasetInstance,
    private readonly query: DatasetQuery,
    private readonly context: ExecutionContext | undefined,
  ) {}

  /** The measures of the view: the dataset's, plus every calculation measure. */
  get measures(): Record<string, DatasetMeasureDefinition> {
    return { ...this.ds.measures, ...this.added };
  }

  /**
   * A reference to an earlier output, or to a measure the dataset publishes.
   * The envelope has already refused forward references, earlier outputs of a
   * kind this entry does not accept, relationship measures, and unselected
   * measures where an entry reads selected ones; what is left is the contract.
   */
  private input(name: string, label: string): { internal: string; timed: boolean } | undefined {
    const earlier = this.available.get(name);
    if (earlier !== undefined) return { internal: earlier.internal, timed: earlier.timed };
    if (!Object.hasOwn(this.ds.measures, name)) {
      this.errors.push(`${label} reads unknown measure "${name}".`);
      return undefined;
    }
    const timed = measureDependencyNames(this.ds.measures, [name])
      .some(dependency => isShiftMeasure(this.ds.measures[dependency]) || isWindowMeasure(this.ds.measures[dependency]));
    return { internal: name, timed };
  }

  private add(internal: string, definition: DatasetMeasureDefinition, publicName: string, kind: QueryCalculationKind, timed: boolean): void {
    this.added[internal] = definition;
    this.available.set(publicName, { internal, kind, timed });
  }

  plan(entry: DatasetQueryCalculation, index: number): void {
    const label = entryLabel(entry, index);
    const kind = calculationKind(entry)!;
    const internal = `${CALCULATION_INTERNAL_PREFIX}${index}`;
    if (!PLANNED_KINDS.has(kind)) {
      this.unsupported.push(`${label}: "${kind}" calculations are not supported by this executor yet.`);
      return;
    }
    switch (kind) {
      case 'filter': return this.filter(entry as Extract<DatasetQueryCalculation, { filter: unknown }>, internal, label);
      case 'shift': return this.shift(entry as Extract<DatasetQueryCalculation, { shift: unknown }>, internal, label);
      case 'window': return this.window(entry as Extract<DatasetQueryCalculation, { window: unknown }>, internal, label);
      case 'formula': return this.formula(entry as Extract<DatasetQueryCalculation, { formula: unknown }>, internal, label);
      case 'compare': return this.compare(entry as Extract<DatasetQueryCalculation, { compare: unknown }>, internal, label);
    }
  }

  private filter(entry: Extract<DatasetQueryCalculation, { filter: unknown }>, internal: string, label: string): void {
    const { measure, where } = entry.filter;
    const input = this.input(measure, label);
    if (input === undefined) return;
    const base = getBaseMeasure(this.ds.measures, measure);
    if (base === undefined) {
      this.errors.push(`${label} must filter a base measure; "${measure}" is not one.`);
      return;
    }
    if (UNFILTERABLE.has(base.aggregation)) {
      this.errors.push(`${label} cannot filter "${measure}": ${base.aggregation} measures do not accept filters.`);
      return;
    }
    const filters = effectiveFilters(this.ds);
    for (const filter of where) {
      const field = Object.hasOwn(filters, filter.field) ? filters[filter.field]!.field : undefined;
      if (field !== undefined && this.ds.dimensions[field]?.fieldType === 'timestamp') {
        this.errors.push(`${label} cannot compare time field "${filter.field}"; bound time with the query's filters.`);
      }
    }
    this.errors.push(...queryFilterErrors(this.ds, where, this.context).map(error => `${label}: ${error}`));
    const definition: MeasureDefinition = { ...base, filters: [...(base.filters ?? []), ...where.map(filter => ({ ...filter }))] };
    this.add(internal, definition, entry.name, 'filter', false);
  }

  private shift(entry: Extract<DatasetQueryCalculation, { shift: unknown }>, internal: string, label: string): void {
    const { measure, amount, unit } = entry.shift;
    const input = this.input(measure, label);
    if (input === undefined) return;
    if (input.timed) {
      this.errors.push(`${label} cannot shift "${measure}", which already depends on a shift or window.`);
      return;
    }
    const definition: ShiftMeasureDefinition = {
      __type: 'shift_measure_definition', measure: input.internal, interval: { amount, unit },
    };
    this.add(internal, definition, entry.name, 'shift', true);
  }

  private window(entry: Extract<DatasetQueryCalculation, { window: unknown }>, internal: string, label: string): void {
    const { measure } = entry.window;
    const input = this.input(measure, label);
    if (input === undefined) return;
    if (getBaseMeasure(this.measures, input.internal) === undefined) {
      this.errors.push(`${label} must window a base measure; "${measure}" is not one.`);
      return;
    }
    const mode = entry.window.trailing !== undefined
      ? { trailing: { ...entry.window.trailing } }
      : entry.window.toDate !== undefined ? { toDate: entry.window.toDate } : { cumulative: true as const };
    const definition = { __type: 'window_measure_definition', measure: input.internal, ...mode } as WindowMeasureDefinition;
    this.add(internal, definition, entry.name, 'window', true);
  }

  private formula(entry: Extract<DatasetQueryCalculation, { formula: unknown }>, internal: string, label: string): void {
    const resolved = new Map<string, string>();
    let timed = false;
    for (const name of formulaReferences(entry.formula)) {
      const input = this.input(name, label);
      if (input === undefined) return;
      resolved.set(name, input.internal);
      timed ||= input.timed;
    }
    this.add(internal, formulaMeasure(entry.formula, name => resolved.get(name) ?? name), entry.name, 'formula', timed);
  }

  private compare(entry: Extract<DatasetQueryCalculation, { compare: unknown }>, internal: string, label: string): void {
    const { to, measures } = entry.compare;
    // The envelope requires `by` for every compare.
    const unit = to === 'previousYear' ? 'year' : this.query.by!;
    measures.forEach((measure, at) => {
      const input = this.input(measure, label);
      if (input === undefined) return;
      if (input.timed) {
        this.errors.push(`${label} cannot compare "${measure}", which already depends on a shift or window.`);
        return;
      }
      const base = `${internal}_${at}`;
      const previous = `${base}_previous`;
      this.add(previous, { __type: 'shift_measure_definition', measure: input.internal, interval: { amount: 1, unit } },
        `${measure}_previous`, 'compare', true);
      const read = (name: string) => (name === 'previous' ? previous : input.internal);
      this.add(`${base}_change`, formulaMeasure({ op: 'subtract', args: ['current', 'previous'] }, read),
        `${measure}_change`, 'compare', true);
      this.add(`${base}_change_pct`, formulaMeasure({ op: 'percentChange', args: ['current', 'previous'] }, read),
        `${measure}_change_pct`, 'compare', true);
    });
  }
}

/** Replaces internal names in planner messages with the names the caller wrote. */
function publicMessage(message: string, outputs: readonly CalculationOutput[]): string {
  return [...outputs]
    .sort((left, right) => right.internal.length - left.internal.length)
    .reduce((text, output) => text.split(output.internal).join(output.name), message);
}

/** Plans a dataset query that carries calculations, `limitBy` or `other`. */
export function planQueryCalculations(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  context?: ExecutionContext,
): QueryCalculationPlanResult {
  const errors = envelopeErrors(query);
  if (errors.length > 0) return { errors, unsupported: [] };

  const reserved = [...Object.keys(ds.measures), ...Object.keys(ds.dimensions)]
    .filter(name => name.startsWith(CALCULATION_INTERNAL_PREFIX));
  if (reserved.length > 0) {
    return {
      errors: [`Dataset "${ds.name}" declares ${reserved.map(name => `"${name}"`).join(', ')}; `
        + `the "${CALCULATION_INTERNAL_PREFIX}" prefix is reserved for query calculations.`],
      unsupported: [],
    };
  }

  const selectedMeasures = query.measures ?? baseMeasureNames(ds.measures);
  const planner = new CalculationPlanner(ds, query, context);
  const unsupported = [
    ...(query.limitBy === undefined ? [] : ['"limitBy" is not supported by this executor yet.']),
    ...(query.other === undefined ? [] : ['"other" is not supported by this executor yet.']),
  ];
  (query.calculations ?? []).forEach((entry, index) => planner.plan(entry, index));
  unsupported.push(...planner.unsupported);
  if (planner.errors.length > 0 || unsupported.length > 0) {
    return { errors: planner.errors, unsupported };
  }

  const outputs = calculationOutputs(query);
  const measures = planner.measures;
  const view: AnyDatasetInstance = { ...ds, measures, derivedMeasures: derivedMeasuresView(measures) };
  try {
    validateShiftMeasures(ds.name, view.timeKey, measures);
    validateWindowMeasures(ds.name, view.timeKey, measures);
  } catch (error) {
    return { errors: [publicMessage((error as Error).message, outputs)], unsupported: [] };
  }

  const {
    calculations: _calculations, limitBy: _limitBy, other: _other,
    having: _having, orderBy: _orderBy, limit: _limit, offset: _offset,
    ...rest
  } = query;
  const inner: DatasetQuery = { ...rest, measures: [...selectedMeasures, ...outputs.map(output => output.internal)] };

  const outerErrors = outerStageErrors(ds, query, selectedMeasures, outputs);
  if (outerErrors.length > 0) return { errors: outerErrors, unsupported: [] };

  return {
    errors: [],
    unsupported: [],
    plan: {
      dataset: view,
      inner,
      selectedMeasures,
      outputs,
      having: query.having ?? [],
      orderBy: query.orderBy ?? [],
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.offset === undefined ? {} : { offset: query.offset }),
    },
  };
}

/** `having`, `orderBy` and the limits that span calculation outputs. */
function outerStageErrors(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  selectedMeasures: readonly string[],
  outputs: readonly CalculationOutput[],
): string[] {
  const errors: string[] = [];
  const outputNames = outputs.map(output => output.name);
  const values = [...selectedMeasures, ...outputNames];
  // Validated as if every output were a selected measure of the base dataset,
  // which is what an outer-stage condition reads.
  // The outer stage runs after every planner, so time-measure queries accept
  // `having` here even though the grouped planners refuse it.
  errors.push(...datasetHavingErrors(ds, { ...query, measures: [] }, values));
  const orderable = new Set([...(query.dimensions ?? []), ...values, ...(query.by ? ['period'] : [])]);
  const unknown = (query.orderBy ?? []).map(order => order.field).filter(field => !orderable.has(field));
  if (unknown.length > 0) {
    errors.push(`Unknown orderBy fields: ${unknown.join(', ')}. Available: ${[...orderable].join(', ')}`);
  }
  const maxMeasures = ds.limits?.maxMeasures;
  if (maxMeasures && values.length > maxMeasures) {
    errors.push(`Too many measures and calculation outputs: ${values.length} (max ${maxMeasures})`);
  }
  const maxFilters = ds.limits?.maxFilters;
  const predicates = (query.filters?.length ?? 0) + (query.having?.length ?? 0)
    + (query.calculations ?? []).reduce((count, entry) => (
      count + ('filter' in entry && Array.isArray(entry.filter?.where) ? entry.filter.where.length : 0)
    ), 0);
  if (maxFilters && predicates > maxFilters) {
    errors.push(`Too many filters, having conditions and filter-calculation conditions: ${predicates} (max ${maxFilters})`);
  }
  return errors;
}

/** Maps internal names in planner errors back to the caller's names. */
export function publicCalculationErrors(errors: readonly string[], outputs: readonly CalculationOutput[]): string[] {
  return errors.map(error => publicMessage(error, outputs));
}
