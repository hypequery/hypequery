import { matchTypeCall } from './clickhouse-type-utils.js';

/** A dataset dimension type the scaffolder can emit. */
export type ScaffoldDimensionType = 'string' | 'number' | 'boolean' | 'timestamp';

export interface NamedTupleElement {
  name: string;
  type: ScaffoldDimensionType;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The value type behind `Nullable`, `LowCardinality` and
 * `SimpleAggregateFunction(fn, T)` wrappers; none changes what a value is.
 */
export function unwrapClickHouseType(type: string): string {
  let current = type.trim();
  const simple = /^SimpleAggregateFunction\(\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*(.+)\)$/s.exec(current);
  if (simple) current = simple[1].trim();
  for (;;) {
    const wrapped = /^(?:Nullable|LowCardinality)\((.*)\)$/s.exec(current);
    if (!wrapped) return current;
    current = wrapped[1].trim();
  }
}

/**
 * Maps a ClickHouse column type to a dataset dimension type, or null when no
 * scalar dimension type describes its values (Array, Tuple, Map, geo, JSON,
 * Interval, ...). The outer type name is matched exactly: a substring match
 * reads `Point` or `Array(Int32)` as numbers. Mirrors Cloud's `protocolTypeOf`
 * so a table scaffolds with the same field types in both.
 */
export function clickHouseDimensionType(type: string): ScaffoldDimensionType | null {
  const value = unwrapClickHouseType(type);
  if (/^(?:U?Int\d+|Float\d+|Decimal\d*)(?:\(.*\))?$/s.test(value)) return 'number';
  if (/^(?:Date|Date32|DateTime|DateTime64)(?:\(.*\))?$/s.test(value)) return 'timestamp';
  if (value === 'Bool') return 'boolean';
  if (/^(?:String|FixedString|UUID|Enum\d*|IPv4|IPv6)(?:\(.*\))?$/s.test(value)) return 'string';
  return null;
}

/**
 * The scalar elements of a named `Tuple(name T, ...)` column, each of which can
 * be its own dimension through `tupleElement`. Null for any other type,
 * including unnamed tuples, whose positions carry no meaning to name a field
 * after. Elements without a scalar type or a plain identifier name are left out.
 */
export function namedTupleElements(type: string): NamedTupleElement[] | null {
  const parts = matchTypeCall(unwrapClickHouseType(type), 'Tuple');
  if (!parts?.length) return null;

  const elements: NamedTupleElement[] = [];
  for (const part of parts) {
    const named = /^(\S+)\s+(.+)$/s.exec(part);
    // Element types never contain top-level whitespace before their first
    // `(`, so a part without a name-then-space prefix is an unnamed element.
    if (!named || named[1].includes('(')) return null;
    const elementType = clickHouseDimensionType(named[2]);
    if (IDENTIFIER.test(named[1]) && elementType) {
      elements.push({ name: named[1], type: elementType });
    }
  }
  return elements;
}
