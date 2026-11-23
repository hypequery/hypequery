import { z, type ZodTypeAny } from 'zod';
import { isNullCheckFilterOperator, SEMANTIC_FILTER_OPERATORS } from '../constants.js';
import { uniqueSorted } from './canonical-json.js';
import { datasetTimeKeys } from './dataset-time-keys.js';
import type { FilterPolicy } from './effective-filters.js';

/**
 * Caller filter schemas for semantic query inputs: one comparison per field
 * with that field's operators, and optionally `inDateRange` on time axes and
 * `and` / `or` / `not` groups over them (RFC 0029).
 */

const RELATIVE_DATE_UNITS = ['day', 'week', 'month', 'quarter', 'year'] as const;

/** Every relative range of the RFC 0029 grammar without a count. */
export const RELATIVE_DATE_RANGES = Object.freeze([
  'today',
  'yesterday',
  ...RELATIVE_DATE_UNITS.map(unit => `this ${unit}`),
  ...RELATIVE_DATE_UNITS.map(unit => `last ${unit}`),
  'month to date',
  'quarter to date',
  'year to date',
]);

/** `last <N> <unit>(s)`, the counted form, N from 1 to 9999. */
const LAST_N = /^last [1-9][0-9]{0,3} (day|week|month|quarter|year)s?$/;

export interface FilterLeafOptions {
  /**
   * One comparison shape per distinct operator set rather than per field,
   * with the fields as an enum. Accepts exactly the same filters in fewer
   * bytes; off where existing schemas must stay byte-identical.
   */
  readonly compact?: boolean;
  /** Fields that also accept `inDateRange` with a relative range value. */
  readonly relativeDateFields?: readonly string[];
}

export function fieldEnum(values: readonly string[]): ZodTypeAny {
  const unique = uniqueSorted([...values]);
  return unique.length > 0
    ? z.enum(unique as [string, ...string[]])
    : z.never();
}

/** The RFC 0029 relative range grammar: the fixed forms as an enum, `last N units` as a pattern. */
export function relativeDateRangeSchema(): ZodTypeAny {
  return z.union([
    z.enum(RELATIVE_DATE_RANGES as [string, ...string[]]),
    z.string().regex(LAST_N),
  ]).describe('Resolved by the server in the query timezone. "last N days" ends before today.');
}

function operatorsFor(
  field: string,
  localFilters: Readonly<Record<string, FilterPolicy>>,
  relationshipOperators: ReadonlyMap<string, string[]>,
): readonly string[] {
  return relationshipOperators.has(field)
    ? relationshipOperators.get(field) ?? []
    : localFilters[field]?.operators ?? [...SEMANTIC_FILTER_OPERATORS];
}

/** Comparison variants: a value form and, where allowed, a value-free null check (RFC 0023). */
export function filterLeafVariants(
  localFilters: Readonly<Record<string, FilterPolicy>>,
  fields: readonly string[],
  relationshipOperators: ReadonlyMap<string, string[]>,
  options: FilterLeafOptions = {},
): ZodTypeAny[] {
  const filterValue = z.unknown().refine(value => value !== undefined, 'Required');
  // Fields with the same operators share a shape when compact; otherwise each
  // field is its own group, as the original per-field form has it.
  const groups = new Map<string, { fields: string[]; operators: readonly string[] }>();
  for (const field of uniqueSorted([...fields])) {
    const operators = operatorsFor(field, localFilters, relationshipOperators);
    const key = options.compact ? uniqueSorted([...operators]).join(',') : field;
    const group = groups.get(key) ?? { fields: [], operators };
    group.fields.push(field);
    groups.set(key, group);
  }
  const variants = [...groups.values()].flatMap(({ fields: names, operators }) => {
    const field = names.length === 1 ? z.literal(names[0]) : fieldEnum(names);
    const valueOperators = operators.filter(operator => !isNullCheckFilterOperator(operator));
    const nullChecks = operators.filter(isNullCheckFilterOperator);
    return [
      ...(valueOperators.length > 0 || nullChecks.length === 0
        ? [z.object({ field, operator: fieldEnum(valueOperators), value: filterValue }).strict()]
        : []),
      ...(nullChecks.length > 0
        ? [z.object({ field, operator: fieldEnum(nullChecks) }).strict()]
        : []),
    ];
  });
  const relative = options.relativeDateFields ?? [];
  if (relative.length > 0) {
    variants.push(z.object({
      field: relative.length === 1 ? z.literal(relative[0]) : fieldEnum(relative),
      operator: z.literal('inDateRange'),
      value: relativeDateRangeSchema(),
    }).strict());
  }
  return variants;
}

/** The schema of one top-level `filters` item. */
export function filterItemSchema(
  variants: readonly ZodTypeAny[],
  options: { readonly groups?: boolean } = {},
): ZodTypeAny {
  if (variants.length === 0) {
    return z.object({
      field: z.never(),
      operator: z.enum(SEMANTIC_FILTER_OPERATORS),
      value: z.unknown().refine(value => value !== undefined, 'Required'),
    }).strict();
  }
  if (!options.groups) {
    return variants.length === 1
      ? variants[0]
      : z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }
  // A group's items are comparisons or further groups, so the schema refers
  // to itself; JSON Schema carries that as one `$ref`'d definition rather than
  // repeating every comparison at each level.
  // Getters rather than `z.lazy`, so JSON Schema refers to the definition
  // directly instead of wrapping each reference in an `allOf`.
  const node: ZodTypeAny = z.union([
    ...variants,
    z.object({ get and() { return z.array(node).min(1); } }).strict(),
    z.object({ get or() { return z.array(node).min(1); } }).strict(),
    z.object({ get not() { return node; } }).strict(),
  ] as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]).describe(
    'A comparison, or { and: [...] }, { or: [...] } or { not: ... } over them.',
  );
  return node;
}

interface TimeAxisSource {
  readonly name?: string;
  readonly timeKey?: string;
  readonly timeKeys?: readonly string[];
  readonly dimensions: Readonly<Record<string, { readonly column?: string; readonly type?: string }>>;
}

/** Whether a local filter reads a timestamp dimension, through its own name or an alias. */
export function isTimestampFilter(
  source: TimeAxisSource,
  localFilters: Readonly<Record<string, FilterPolicy>>,
  field: string,
): boolean {
  const resolved = localFilters[field]?.field ?? field;
  return source.dimensions[resolved]?.type === 'timestamp';
}

/**
 * Whether a local filter compares one of the dataset's time axes. Compared by
 * backing column, as the planner reads the axis: a filter or a `timeKey` may
 * name a column that a differently named dimension reads.
 */
export function isTimeAxisFilter(
  source: TimeAxisSource,
  localFilters: Readonly<Record<string, FilterPolicy>>,
  field: string,
): boolean {
  if (field.includes('.')) return false;
  const column = (name: string) => source.dimensions[name]?.column ?? name;
  const resolved = column(localFilters[field]?.field ?? field);
  return datasetTimeKeys(source).some(key => column(key) === resolved);
}

/**
 * The filters that compare a time axis and allow both `gte` and `lt`, the
 * effective operators of `inDateRange`.
 */
export function relativeDateFilterFields(
  source: TimeAxisSource,
  localFilters: Readonly<Record<string, FilterPolicy>>,
  fields: readonly string[],
): string[] {
  return uniqueSorted(fields.filter((field) => {
    if (!Object.hasOwn(localFilters, field) || !isTimeAxisFilter(source, localFilters, field)) return false;
    const operators = localFilters[field].operators ?? SEMANTIC_FILTER_OPERATORS;
    return operators.includes('gte') && operators.includes('lt');
  }));
}
