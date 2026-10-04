import { createFilter } from './utils/filter-definition.js';
import type { MetricFilter, MetricOrderBy } from './types.js';

export function eq<const TField extends string, const TValue>(field: TField, value: TValue): MetricFilter<TField, TValue, 'eq'> {
  return createFilter(field, 'eq', value);
}

export function neq<const TField extends string, const TValue>(field: TField, value: TValue): MetricFilter<TField, TValue, 'neq'> {
  return createFilter(field, 'neq', value);
}

export function gt<const TField extends string, const TValue>(field: TField, value: TValue): MetricFilter<TField, TValue, 'gt'> {
  return createFilter(field, 'gt', value);
}

export function gte<const TField extends string, const TValue>(field: TField, value: TValue): MetricFilter<TField, TValue, 'gte'> {
  return createFilter(field, 'gte', value);
}

export function lt<const TField extends string, const TValue>(field: TField, value: TValue): MetricFilter<TField, TValue, 'lt'> {
  return createFilter(field, 'lt', value);
}

export function lte<const TField extends string, const TValue>(field: TField, value: TValue): MetricFilter<TField, TValue, 'lte'> {
  return createFilter(field, 'lte', value);
}

export function inList<const TField extends string, const TValue>(field: TField, value: TValue[]): MetricFilter<TField, TValue[], 'in'> {
  return createFilter(field, 'in', value);
}

export function notInList<const TField extends string, const TValue>(field: TField, value: TValue[]): MetricFilter<TField, TValue[], 'notIn'> {
  return createFilter(field, 'notIn', value);
}

export function between<const TField extends string, const TLower, const TUpper>(field: TField, lower: TLower, upper: TUpper): MetricFilter<TField, [TLower, TUpper], 'between'> {
  return createFilter(field, 'between', [lower, upper]);
}

export function like<const TField extends string>(field: TField, value: string): MetricFilter<TField, string, 'like'> {
  return createFilter(field, 'like', value);
}

export function asc<const TField extends string>(field: TField): MetricOrderBy<TField> {
  return { field, direction: 'asc' };
}

export function desc<const TField extends string>(field: TField): MetricOrderBy<TField> {
  return { field, direction: 'desc' };
}

export const filter = {
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  inList,
  notInList,
  between,
  like,
} as const;

export const order = {
  asc,
  desc,
} as const;
