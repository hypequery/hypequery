import { z, type ZodTypeAny } from 'zod';
import { SUPPORTED_TIME_GRAINS } from '../constants.js';
import type { DatasetQuery } from '../types.js';
import { calculationOutputs } from './query-calculation-outputs.js';
import { fieldEnum } from './query-schema-filters.js';

/**
 * Schemas for RFC 0026 query-scoped calculations, `limitBy` and `other` on a
 * dataset query input. Field names stay enums of the dataset's fields; an
 * input reference may also name an earlier entry's output, which the caller
 * names, so it is an identifier and the planner checks what it resolves to.
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORMULA_OPERATORS = [
  'add', 'subtract', 'multiply', 'divide', 'nullIfZero', 'coalesce', 'round', 'floor', 'ceil', 'percentChange',
] as const;
/** RFC 0026 ceilings: shift and trailing amounts, `other.n`, and the remainder label. */
const MAX_INTERVAL = 1000;
const MAX_OTHER = 1000;
const MAX_LABEL = 64;

export interface CalculationSchemaFields {
  /** Groupable dimensions: what `rank.within`, `share.of` and `limitBy.by` may name. */
  readonly dimensions: readonly string[];
  /** Whether the dataset has a time axis, so `period` is a grouping key under a grain. */
  readonly hasTime: boolean;
  /** Base measures a filter calculation may condition. */
  readonly filterMeasures: readonly string[];
  /** Base and derived measures `other` may rank by. */
  readonly bucketMeasures: readonly string[];
  /** Local string dimensions `other` may bucket. */
  readonly bucketDimensions: readonly string[];
  /** Comparison shapes a filter calculation's `where` accepts. */
  readonly whereVariants: readonly ZodTypeAny[];
  /** Most calculation entries one query may carry. */
  readonly maxCalculations?: number;
}

/** Base aggregations a filter calculation cannot condition, as for model-level filtered measures. */
const UNFILTERABLE_AGGREGATIONS = new Set(['argMax', 'argMin', 'merge']);

interface MeasureSource {
  readonly measures: Readonly<Record<string, { readonly aggregation?: string; readonly kind?: string }>>;
  readonly derivedMeasures?: Readonly<Record<string, unknown>>;
}

/**
 * The measures a calculation may name by field: a filter calculation's base
 * measure (local, neither window nor shift, and filterable), and what `other`
 * ranks by (a base or derived measure).
 */
export function calculationMeasures(
  source: MeasureSource,
): Pick<CalculationSchemaFields, 'filterMeasures' | 'bucketMeasures'> {
  const base = Object.entries(source.measures).filter(([, entry]) => entry.kind === undefined && entry.aggregation !== undefined);
  return {
    filterMeasures: base.filter(([, entry]) => !UNFILTERABLE_AGGREGATIONS.has(entry.aggregation!)).map(([name]) => name),
    bucketMeasures: [...base.map(([name]) => name), ...Object.keys(source.derivedMeasures ?? {})],
  };
}

/** A simple identifier (RFC 0002): what a calculation is named. */
export function identifierSchema(): ZodTypeAny {
  return z.string().regex(IDENTIFIER);
}

/**
 * A measure or an earlier output. Its grammar and what it resolves to are the
 * planner's to check, so the schema spends no bytes repeating the pattern.
 */
export function referenceSchema(): ZodTypeAny {
  return z.string();
}

function union(schemas: readonly ZodTypeAny[]): ZodTypeAny {
  return schemas.length === 1 ? schemas[0] : z.union(schemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

/** Exactly one of `keys` is present on `value`. */
function exactlyOne(value: unknown, keys: readonly string[]): boolean {
  return keys.filter(key => (value as Record<string, unknown>)[key] !== undefined).length === 1;
}

/**
 * One entry: a `name` and exactly one kind member. A single object with every
 * kind optional, rather than one object per kind, keeps `name` and the
 * object's framing in the schema once; the "exactly one" rule is checked here.
 */
function calculationEntry(fields: CalculationSchemaFields): ZodTypeAny {
  const reference = referenceSchema();
  const unit = z.enum(SUPPORTED_TIME_GRAINS as [string, ...string[]]);
  const amount = z.number().int().min(1).max(MAX_INTERVAL);
  const partition = z.array(fieldEnum([...fields.dimensions, ...(fields.hasTime ? ['period'] : [])])).optional();
  const formula: ZodTypeAny = z.object({
    op: z.enum(FORMULA_OPERATORS),
    get args() { return z.array(z.union([reference, z.number().finite(), formula])).min(1).max(2); },
  }).strict();
  const windowModes = ['trailing', 'toDate', 'cumulative'] as const;
  const kinds: Record<string, ZodTypeAny> = {
    ...(fields.filterMeasures.length > 0 && fields.whereVariants.length > 0 ? {
      filter: z.object({
        measure: fieldEnum(fields.filterMeasures),
        where: z.array(union(fields.whereVariants)).min(1),
      }).strict(),
    } : {}),
    ...(fields.hasTime ? {
      shift: z.object({ measure: reference, amount, unit }).strict(),
      window: z.object({
        measure: reference,
        trailing: z.object({ amount, unit }).strict().optional(),
        toDate: z.enum(SUPPORTED_TIME_GRAINS.filter(grain => grain !== 'minute') as [string, ...string[]]).optional(),
        cumulative: z.literal(true).optional(),
      }).strict().refine(
        window => exactlyOne(window, windowModes),
        'Use exactly one of trailing, toDate or cumulative.',
      ).describe('Exactly one of trailing, toDate or cumulative.'),
      compare: z.object({
        to: z.enum(['previousPeriod', 'previousYear']),
        measures: z.array(reference).min(1),
      }).strict(),
    } : {}),
    formula,
    rank: z.object({ measure: reference, within: partition, direction: z.enum(['asc', 'desc']).optional() }).strict(),
    share: z.object({ measure: reference, of: partition }).strict(),
  };
  const names = Object.keys(kinds);
  return z.object({
    name: identifierSchema(),
    ...Object.fromEntries(Object.entries(kinds).map(([kind, schema]) => [kind, schema.optional()])),
  }).strict().refine(
    value => exactlyOne(value, names),
    `Give each calculation exactly one of ${names.join(', ')}.`,
  );
}

/**
 * `calculations`, `limitBy` and `other` for a dataset query. Each is left out
 * when the dataset has nothing it could name, so no advertised option is one
 * every call would fail.
 */
export function calculationShape(fields: CalculationSchemaFields): Record<string, ZodTypeAny> {
  const groupKeys = [...fields.dimensions, ...(fields.hasTime ? ['period'] : [])];
  const calculations = z.array(calculationEntry(fields));
  return {
    calculations: (fields.maxCalculations === undefined ? calculations : calculations.max(fields.maxCalculations))
      .optional()
      .describe(
        'Each is a name and exactly one kind. Inputs name a selected measure or an earlier output; '
        + 'shift, window and compare need grain and a time range filter. Outputs can be ordered by and used in having.',
      ),
    ...(groupKeys.length > 0 ? {
      limitBy: z.object({
        n: z.number().int().positive(),
        by: z.array(fieldEnum(groupKeys)).min(1),
      }).strict().optional().describe('Keep the first n rows of each by group, in orderBy order (orderBy required).'),
    } : {}),
    ...(fields.bucketDimensions.length > 0 && fields.bucketMeasures.length > 0 ? {
      other: z.object({
        dimension: fieldEnum(fields.bucketDimensions),
        n: z.number().int().min(1).max(MAX_OTHER),
        measure: fieldEnum(fields.bucketMeasures),
        label: z.string().min(1).max(MAX_LABEL).optional(),
      }).strict().optional().describe('Keep the top n values of a selected dimension by measure; group the rest under label (default "Other").'),
    } : {}),
  };
}

/**
 * `orderBy` and `having` may name a calculation output as well as a published
 * field. Outputs are named by the query itself, so whether a name is one is
 * checked here, against the calculations the call carries.
 */
export function refineCalculationReferences(
  input: Pick<DatasetQuery, 'calculations' | 'orderBy' | 'having'>,
  published: { readonly orderable: ReadonlySet<string>; readonly measures: ReadonlySet<string> },
  context: z.RefinementCtx,
): void {
  const outputs = new Set(calculationOutputs(input).map(output => output.name));
  input.orderBy?.forEach((order, index) => {
    if (!published.orderable.has(order.field) && !outputs.has(order.field)) {
      context.addIssue({
        code: 'custom',
        path: ['orderBy', index, 'field'],
        message: 'Not a field this dataset can order by, or an output of this query\'s calculations.',
      });
    }
  });
  input.having?.forEach((condition, index) => {
    if (!published.measures.has(condition.measure) && !outputs.has(condition.measure)) {
      context.addIssue({
        code: 'custom',
        path: ['having', index, 'measure'],
        message: 'Not a measure of this dataset, or an output of this query\'s calculations.',
      });
    }
  });
}
