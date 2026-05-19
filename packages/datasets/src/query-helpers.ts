import type { MetricFilter, MetricOrderBy } from './types.js';

function createFilter<TField extends string>(
  field: TField,
  operator: MetricFilter['operator'],
  value: unknown,
): MetricFilter {
  return { field, operator, value };
}

export function eq<TField extends string>(field: TField, value: unknown): MetricFilter {
  return createFilter(field, 'eq', value);
}

export function neq<TField extends string>(field: TField, value: unknown): MetricFilter {
  return createFilter(field, 'neq', value);
}

export function gt<TField extends string>(field: TField, value: unknown): MetricFilter {
  return createFilter(field, 'gt', value);
}

export function gte<TField extends string>(field: TField, value: unknown): MetricFilter {
  return createFilter(field, 'gte', value);
}

export function lt<TField extends string>(field: TField, value: unknown): MetricFilter {
  return createFilter(field, 'lt', value);
}

export function lte<TField extends string>(field: TField, value: unknown): MetricFilter {
  return createFilter(field, 'lte', value);
}

export function inList<TField extends string>(field: TField, value: unknown[]): MetricFilter {
  return createFilter(field, 'in', value);
}

export function notInList<TField extends string>(field: TField, value: unknown[]): MetricFilter {
  return createFilter(field, 'notIn', value);
}

export function between<TField extends string>(field: TField, lower: unknown, upper: unknown): MetricFilter {
  return createFilter(field, 'between', [lower, upper]);
}

export function like<TField extends string>(field: TField, value: string): MetricFilter {
  return createFilter(field, 'like', value);
}

export function asc<TField extends string>(field: TField): MetricOrderBy {
  return { field, direction: 'asc' };
}

export function desc<TField extends string>(field: TField): MetricOrderBy {
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

