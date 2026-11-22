/**
 * Contract-driven checks for RFC 0026 query-scoped calculations.
 *
 * The protocol validator has already proven the envelope: shapes, output
 * names, references between entries, and that partitions name selected
 * dimensions. What remains needs the contract and the caller's visibility:
 * every published input is a measure the caller may see and of a kind the
 * calculation accepts, filter conditions use filters the caller may apply,
 * and the counts stay within the dataset's ceilings.
 */

import type {
  ProtocolDatasetQuery,
  ProtocolDeploymentDatasetAnyVersion,
  ProtocolQueryCalculation,
} from '@hypequery/protocol';
import { comparisonField } from './utils/semantic-comparison-field.js';

interface CalculationViolation {
  readonly message: string;
  readonly path: string;
}

/** What the caller may use, already narrowed to its visibility. */
export interface CalculationSurface {
  readonly measures: ReadonlySet<string>;
  readonly filters: ReadonlyMap<string, ReadonlySet<string>>;
  readonly hasTimeField: boolean;
}

type MeasureShape = { readonly name: string; readonly kind?: string; readonly aggregation?: string };

const UNFILTERABLE = new Set(['argMax', 'argMin', 'merge']);
const CUMULATIVE = new Set(['sum', 'count', 'min', 'max']);
const COMPARE_SUFFIXES = ['_previous', '_change', '_change_pct'];

/** Every output column a query's calculations add, in output order. */
export function calculationOutputNames(operation: ProtocolDatasetQuery): string[] {
  return (operation.calculations ?? []).flatMap(entry => (
    'compare' in entry
      ? entry.compare.measures.flatMap(measure => COMPARE_SUFFIXES.map(suffix => `${String(measure)}${suffix}`))
      : [String(entry.name)]
  ));
}

/** How many filter-calculation conditions the query adds to the predicate budget. */
export function calculationConditionCount(operation: ProtocolDatasetQuery): number {
  return (operation.calculations ?? []).reduce((count, entry) => count + ('filter' in entry ? entry.filter.where.length : 0), 0);
}

export function validateSemanticCalculations(
  operation: ProtocolDatasetQuery,
  dataset: ProtocolDeploymentDatasetAnyVersion,
  surface: CalculationSurface,
): readonly CalculationViolation[] {
  const violations: CalculationViolation[] = [];
  const fail = (message: string, path: string) => violations.push({ message, path });
  const measures = new Map(
    (dataset.measures as readonly MeasureShape[]).map(measure => [String(measure.name), measure]),
  );
  const dimensions = new Map(dataset.dimensions.map(dimension => [String(dimension.name), dimension]));
  const outputs = new Set<string>();

  /** A published input, or undefined when it reads an earlier output or failed. */
  const published = (name: string, path: string): MeasureShape | undefined => {
    if (outputs.has(name)) return undefined;
    const measure = measures.get(name);
    // A hidden measure reads exactly like an unknown one (RFC 0019).
    if (measure === undefined || !surface.measures.has(name)) {
      fail(`Unknown measure "${name}".`, path);
      return undefined;
    }
    return measure;
  };
  const timed = (measure: MeasureShape | undefined) => measure?.kind === 'shift' || measure?.kind === 'window';

  (operation.calculations ?? []).forEach((entry: ProtocolQueryCalculation, index) => {
    const path = `$.operation.calculations[${index}]`;
    if ('filter' in entry) {
      const measure = published(String(entry.filter.measure), `${path}.filter.measure`);
      if (measure !== undefined && measure.kind !== undefined) {
        fail(`A filter calculation must filter a base measure; "${measure.name}" is not one.`, `${path}.filter.measure`);
      } else if (measure !== undefined && UNFILTERABLE.has(String(measure.aggregation))) {
        fail(`"${measure.name}" is a ${measure.aggregation} measure, which does not accept filters.`, `${path}.filter.measure`);
      }
      entry.filter.where.forEach((expression, at) => {
        const wherePath = `${path}.filter.where[${at}]`;
        const comparison = comparisonField(expression);
        const operators = comparison === null ? undefined : surface.filters.get(comparison.field);
        if (comparison === null || operators === undefined) {
          fail(`Unknown or unfilterable field "${comparison?.field ?? ''}".`, wherePath);
          return;
        }
        if (!operators.has(comparison.operator)) {
          fail(`Operator "${comparison.operator}" is not allowed on "${comparison.field}".`, `${wherePath}.operator`);
        }
        if (dimensions.get(comparison.field)?.type === 'timestamp' || String(dataset.timeField) === comparison.field) {
          fail(`A filter calculation cannot compare time field "${comparison.field}"; bound time with filters.`, wherePath);
        }
      });
    } else if ('shift' in entry) {
      const measure = published(String(entry.shift.measure), `${path}.shift.measure`);
      if (timed(measure)) fail(`"${measure!.name}" is already a ${measure!.kind} measure.`, `${path}.shift.measure`);
    } else if ('window' in entry) {
      const measure = published(String(entry.window.measure), `${path}.window.measure`);
      if (measure !== undefined && measure.kind !== undefined) {
        fail(`A window calculation must window a base measure; "${measure.name}" is not one.`, `${path}.window.measure`);
      } else if (measure !== undefined && 'cumulative' in entry.window && !CUMULATIVE.has(String(measure.aggregation))) {
        fail(`Cannot accumulate ${measure.aggregation}; use sum, count, min, or max.`, `${path}.window.cumulative`);
      }
    } else if ('compare' in entry) {
      entry.compare.measures.forEach((name, at) => {
        const measure = outputs.has(String(name)) ? undefined : measures.get(String(name));
        if (timed(measure)) fail(`"${String(name)}" is already a ${measure!.kind} measure.`, `${path}.compare.measures[${at}]`);
      });
    }
    if (('shift' in entry || 'window' in entry || 'compare' in entry) && !surface.hasTimeField) {
      fail('This dataset has no time field, so time calculations do not apply.', path);
    }
    for (const output of 'compare' in entry
      ? entry.compare.measures.flatMap(measure => COMPARE_SUFFIXES.map(suffix => `${String(measure)}${suffix}`))
      : [String(entry.name)]) {
      outputs.add(output);
    }
  });

  if (operation.other !== undefined) {
    const { dimension, measure } = operation.other;
    if (dimensions.get(String(dimension))?.type !== 'string') {
      fail(`"other" groups a string dimension; "${String(dimension)}" is not one.`, '$.operation.other.dimension');
    }
    const ranked = published(String(measure), '$.operation.other.measure');
    if (timed(ranked)) fail(`"other" cannot rank by ${ranked!.kind} measure "${ranked!.name}".`, '$.operation.other.measure');
  }
  return violations;
}
