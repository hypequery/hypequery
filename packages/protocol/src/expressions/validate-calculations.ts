/**
 * RFC 0026 envelope validation for `calculations`, `limitBy` and `other`.
 *
 * Everything here is decidable from the query alone: shapes, arities, output
 * names, references between entries, and what the query selects. Whether an
 * input is a published measure, visible to the caller, or of the right
 * aggregation is decided against the contract by the data plane and the
 * executor.
 */

import { expressionError } from './errors.js';
import { PROTOCOL_CALCULATION_KINDS, type ProtocolCalculationKind } from './calculations.js';
import type { ProtocolExpression } from './types.js';

type DataRecord = Record<string, unknown>;

/** The primitives `validate.ts` owns, handed over so both modules share one state. */
export interface CalculationValidationKit {
  requireRecord(input: unknown, path: string): DataRecord;
  exactFields(value: DataRecord, required: readonly string[], optional: readonly string[], path: string): void;
  stringValue(value: unknown, path: string): string;
  identifier(value: unknown, path: string, qualified?: boolean): string;
  /** Counts a node toward the depth/node limits and guards against cycles. */
  enter(value: object, depth: number, path: string): void;
  leave(value: object): void;
  arrayValue(value: unknown, path: string): readonly unknown[];
  freezeRecord(entries: Record<string, unknown>): DataRecord;
  predicate(input: unknown, path: string): ProtocolExpression;
}

/** What the rest of the query contributes to calculation validation. */
export interface CalculationQueryShape {
  readonly dimensions: readonly string[];
  readonly measures: readonly string[];
  readonly hasBy: boolean;
}

/** An output column a calculation produces, as later entries may reference it. */
interface Output {
  readonly entry: number;
  readonly kind: ProtocolCalculationKind;
  /** True when the column depends on a shift or window. */
  readonly timed: boolean;
}

const KINDS: ReadonlySet<string> = new Set(PROTOCOL_CALCULATION_KINDS);
const GRAINS: ReadonlySet<string> = new Set(['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year']);
const ARITY: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  add: [2, 2], subtract: [2, 2], multiply: [2, 2], divide: [2, 2],
  nullIfZero: [1, 1], coalesce: [2, 2], round: [1, 2], floor: [1, 1], ceil: [1, 1],
  percentChange: [2, 2],
});
const MAX_INTERVAL = 1000;
const MAX_OTHER = 1000;
const MAX_LABEL = 64;
const MAX_ROUND_DECIMALS = 15;
const COMPARE_SUFFIXES = ['_previous', '_change', '_change_pct'] as const;

const invalid = (path: string): never => expressionError('HQ_EXPRESSION_INVALID_QUERY', path);

function positiveInteger(value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) invalid(path);
  return value as number;
}

/** The output names an entry produces, before any of its references are checked. */
function entryOutputs(
  kit: CalculationValidationKit,
  entry: DataRecord,
  kind: ProtocolCalculationKind,
  name: string,
  path: string,
): readonly string[] {
  if (kind !== 'compare') return [name];
  const compare = kit.requireRecord(entry.compare, `${path}.compare`);
  if (compare.measures === undefined) return [];
  const measures = kit.arrayValue(compare.measures, `${path}.compare.measures`);
  return measures.flatMap((measure, index) => {
    const measurePath = `${path}.compare.measures[${index}]`;
    const base = kit.identifier(measure, measurePath, false);
    return COMPARE_SUFFIXES.map(suffix => {
      try {
        return kit.identifier(`${base}${suffix}`, measurePath, false);
      } catch {
        // The caller wrote a valid measure name; it is the emitted column that
        // cannot exist, which is a query problem rather than a bad identifier.
        return invalid(measurePath);
      }
    });
  });
}

class CalculationValidator {
  private readonly outputs = new Map<string, Output>();
  private readonly selectedMeasures: ReadonlySet<string>;
  private readonly partitionable: ReadonlySet<string>;

  constructor(
    private readonly kit: CalculationValidationKit,
    private readonly query: CalculationQueryShape,
  ) {
    this.selectedMeasures = new Set(query.measures);
    this.partitionable = new Set([...query.dimensions, ...(query.hasBy ? ['period'] : [])]);
  }

  validate(input: unknown): { readonly entries: readonly DataRecord[]; readonly outputs: readonly string[] } {
    const kit = this.kit;
    const values = kit.arrayValue(input, '$.calculations');
    const taken = new Set([...this.query.dimensions, ...this.query.measures, ...(this.query.hasBy ? ['period'] : [])]);
    // Entry names are unique too, so metadata and errors name one entry.
    const entryNames = new Set<string>();
    const shapes = values.map((item, index) => {
      const path = `$.calculations[${index}]`;
      const entry = kit.requireRecord(item, path);
      for (const key of Object.keys(entry)) {
        if (key !== 'name' && !KINDS.has(key)) expressionError('HQ_EXPRESSION_UNKNOWN_FIELD', `${path}.${key}`);
      }
      if (!Object.hasOwn(entry, 'name')) expressionError('HQ_EXPRESSION_TYPE', `${path}.name`);
      const name = kit.identifier(entry.name, `${path}.name`, false);
      const kinds = Object.keys(entry).filter(key => key !== 'name');
      if (kinds.length !== 1) invalid(path);
      const kind = kinds[0] as ProtocolCalculationKind;
      if (entryNames.has(name)) invalid(`${path}.name`);
      entryNames.add(name);
      // Every name is known before any reference is resolved, so a reference
      // to a later entry is recognised as a forward reference rather than
      // mistaken for a published measure.
      for (const output of entryOutputs(kit, entry, kind, name, path)) {
        if (taken.has(output)) invalid(kind === 'compare' ? `${path}.compare.measures` : `${path}.name`);
        taken.add(output);
        this.outputs.set(output, { entry: index, kind, timed: false });
      }
      return { entry, kind, name, path };
    });

    const entries = shapes.map(({ entry, kind, name, path }, index) => {
      kit.enter(entry, 2, path);
      try {
        return kit.freezeRecord({ name, [kind]: this.kind(kind, entry[kind], index, `${path}.${kind}`) });
      } finally {
        kit.leave(entry);
      }
    });
    return { entries: Object.freeze(entries), outputs: Object.freeze([...this.outputs.keys()]) };
  }

  private kind(kind: ProtocolCalculationKind, input: unknown, index: number, path: string): DataRecord {
    const value = this.kit.requireRecord(input, path);
    this.kit.enter(value, 3, path);
    try {
      switch (kind) {
        case 'filter': return this.filter(value, index, path);
        case 'shift': return this.shift(value, index, path);
        case 'window': return this.window(value, index, path);
        case 'formula': return this.formula(value, index, path, 3);
        case 'compare': return this.compare(value, index, path);
        case 'rank': return this.rank(value, index, path);
        case 'share': return this.share(value, index, path);
      }
    } finally {
      this.kit.leave(value);
    }
  }

  /** Marks timed outputs once their entry has validated. */
  private settle(index: number, timed: boolean): void {
    for (const [name, output] of this.outputs) {
      if (output.entry === index) this.outputs.set(name, { ...output, timed });
    }
  }

  /**
   * Resolves an input reference. A name produced by this or a later entry is a
   * forward reference. An earlier output must be of an accepted kind;
   * otherwise the name is a published measure, which `selected` additionally
   * requires the query to select.
   */
  private reference(
    value: unknown,
    path: string,
    index: number,
    accepts: readonly ProtocolCalculationKind[],
    published: 'any' | 'selected' | 'none',
  ): { readonly name: string; readonly output?: Output } {
    const name = this.kit.identifier(value, path, false);
    const output = this.outputs.get(name);
    if (output !== undefined) {
      if (output.entry >= index || !accepts.includes(output.kind)) invalid(path);
      return { name, output };
    }
    if (published === 'none' || (published === 'selected' && !this.selectedMeasures.has(name))) invalid(path);
    return { name };
  }

  private requireBy(path: string): void {
    if (!this.query.hasBy) invalid(path);
  }

  private interval(value: DataRecord, path: string, extra: readonly string[]): { amount: number; unit: string } {
    this.kit.exactFields(value, ['amount', 'unit', ...extra], [], path);
    const amount = positiveInteger(value.amount, `${path}.amount`, MAX_INTERVAL);
    const unit = this.kit.stringValue(value.unit, `${path}.unit`);
    if (!GRAINS.has(unit)) invalid(`${path}.unit`);
    return { amount, unit };
  }

  private partition(value: unknown, path: string): readonly string[] {
    const items = this.kit.arrayValue(value, path);
    const seen = new Set<string>();
    return Object.freeze(items.map((item, at) => {
      const itemPath = `${path}[${at}]`;
      const name = this.kit.identifier(item, itemPath);
      if (!this.partitionable.has(name) || seen.has(name)) invalid(itemPath);
      seen.add(name);
      return name;
    }));
  }

  private filter(value: DataRecord, index: number, path: string): DataRecord {
    this.kit.exactFields(value, ['measure', 'where'], [], path);
    const { name } = this.reference(value.measure, `${path}.measure`, index, [], 'any');
    const where = this.kit.arrayValue(value.where, `${path}.where`);
    if (where.length === 0) invalid(`${path}.where`);
    return this.kit.freezeRecord({
      measure: name,
      where: Object.freeze(where.map((item, at) => {
        const itemPath = `${path}.where[${at}]`;
        const expression = this.kit.predicate(item, itemPath);
        if (!isPlainComparison(expression)) invalid(itemPath);
        return expression;
      })),
    });
  }

  private shift(value: DataRecord, index: number, path: string): DataRecord {
    this.kit.exactFields(value, ['measure', 'amount', 'unit'], [], path);
    const input = this.reference(value.measure, `${path}.measure`, index, ['filter', 'formula'], 'any');
    if (input.output?.timed) invalid(`${path}.measure`);
    const { amount, unit } = this.interval(value, path, ['measure']);
    this.requireBy(path);
    this.settle(index, true);
    return this.kit.freezeRecord({ measure: input.name, amount, unit });
  }

  private window(value: DataRecord, index: number, path: string): DataRecord {
    this.kit.exactFields(value, ['measure'], ['trailing', 'toDate', 'cumulative'], path);
    const input = this.reference(value.measure, `${path}.measure`, index, ['filter'], 'any');
    const modes = ['trailing', 'toDate', 'cumulative'].filter(mode => value[mode] !== undefined);
    if (modes.length !== 1) invalid(path);
    let mode: Record<string, unknown>;
    if (value.trailing !== undefined) {
      const trailingPath = `${path}.trailing`;
      const trailing = this.kit.requireRecord(value.trailing, trailingPath);
      this.kit.enter(trailing, 4, trailingPath);
      try {
        mode = { trailing: this.kit.freezeRecord(this.interval(trailing, trailingPath, [])) };
      } finally {
        this.kit.leave(trailing);
      }
    } else if (value.toDate !== undefined) {
      const grain = this.kit.stringValue(value.toDate, `${path}.toDate`);
      if (!GRAINS.has(grain) || grain === 'minute') invalid(`${path}.toDate`);
      mode = { toDate: grain };
    } else {
      if (value.cumulative !== true) invalid(`${path}.cumulative`);
      mode = { cumulative: true };
    }
    this.requireBy(path);
    this.settle(index, true);
    return this.kit.freezeRecord({ measure: input.name, ...mode });
  }

  private formula(value: DataRecord, index: number, path: string, depth: number): DataRecord {
    const state = { references: 0, timed: false };
    const node = this.formulaNode(value, index, path, depth, state);
    if (state.references === 0) invalid(path);
    this.settle(index, state.timed);
    return node;
  }

  private formulaNode(
    value: DataRecord,
    index: number,
    path: string,
    depth: number,
    state: { references: number; timed: boolean },
  ): DataRecord {
    this.kit.exactFields(value, ['op', 'args'], [], path);
    const op = this.kit.stringValue(value.op, `${path}.op`);
    const arity = Object.hasOwn(ARITY, op) ? ARITY[op] : undefined;
    if (arity === undefined) return invalid(`${path}.op`);
    const args = this.kit.arrayValue(value.args, `${path}.args`);
    if (args.length < arity[0] || args.length > arity[1]) invalid(`${path}.args`);
    return this.kit.freezeRecord({
      op,
      args: Object.freeze(args.map((arg, at) => {
        const argPath = `${path}.args[${at}]`;
        if (op === 'round' && at === 1) {
          if (!Number.isSafeInteger(arg) || (arg as number) < 0 || (arg as number) > MAX_ROUND_DECIMALS) invalid(argPath);
          return arg;
        }
        if (typeof arg === 'string') {
          const input = this.reference(arg, argPath, index, ['filter', 'shift', 'window', 'formula', 'compare'], 'selected');
          state.references += 1;
          if (input.output?.timed) state.timed = true;
          return input.name;
        }
        if (typeof arg === 'number') {
          if (!Number.isFinite(arg)) invalid(argPath);
          return arg;
        }
        if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) return invalid(argPath);
        const child = this.kit.requireRecord(arg, argPath);
        this.kit.enter(child, depth + 1, argPath);
        try {
          return this.formulaNode(child, index, argPath, depth + 1, state);
        } finally {
          this.kit.leave(child);
        }
      })),
    });
  }

  private compare(value: DataRecord, index: number, path: string): DataRecord {
    this.kit.exactFields(value, ['to', 'measures'], [], path);
    const to = this.kit.stringValue(value.to, `${path}.to`);
    if (to !== 'previousPeriod' && to !== 'previousYear') invalid(`${path}.to`);
    const items = this.kit.arrayValue(value.measures, `${path}.measures`);
    if (items.length === 0) invalid(`${path}.measures`);
    const seen = new Set<string>();
    const measures = items.map((item, at) => {
      const itemPath = `${path}.measures[${at}]`;
      const input = this.reference(item, itemPath, index, ['filter', 'formula'], 'selected');
      if (input.output?.timed || seen.has(input.name)) invalid(itemPath);
      seen.add(input.name);
      return input.name;
    });
    this.requireBy(path);
    this.settle(index, true);
    return this.kit.freezeRecord({ to, measures: Object.freeze(measures) });
  }

  private rank(value: DataRecord, index: number, path: string): DataRecord {
    this.kit.exactFields(value, ['measure'], ['within', 'direction'], path);
    const input = this.reference(value.measure, `${path}.measure`, index, ['filter', 'shift', 'window', 'formula', 'compare'], 'selected');
    const result: Record<string, unknown> = { measure: input.name };
    if (value.within !== undefined) result.within = this.partition(value.within, `${path}.within`);
    if (value.direction !== undefined) {
      const direction = this.kit.stringValue(value.direction, `${path}.direction`);
      if (direction !== 'asc' && direction !== 'desc') invalid(`${path}.direction`);
      result.direction = direction;
    }
    this.settle(index, input.output?.timed ?? false);
    return this.kit.freezeRecord(result);
  }

  private share(value: DataRecord, index: number, path: string): DataRecord {
    this.kit.exactFields(value, ['measure'], ['of'], path);
    const input = this.reference(value.measure, `${path}.measure`, index, ['filter', 'shift', 'window', 'formula', 'compare'], 'selected');
    const result: Record<string, unknown> = { measure: input.name };
    if (value.of !== undefined) result.of = this.partition(value.of, `${path}.of`);
    this.settle(index, input.output?.timed ?? false);
    return this.kit.freezeRecord(result);
  }
}

function isPlainComparison(expression: ProtocolExpression): boolean {
  if (expression.kind !== 'comparison' || expression.left.kind !== 'reference') return false;
  if (String(expression.left.name).includes('.')) return false;
  return !('right' in expression) || expression.right.kind === 'literal';
}

/** Validates `calculations`; returns the normalized entries and every output column name. */
export function validateQueryCalculations(
  kit: CalculationValidationKit,
  input: unknown,
  query: CalculationQueryShape,
): { readonly entries: readonly DataRecord[]; readonly outputs: readonly string[] } {
  return new CalculationValidator(kit, query).validate(input);
}

/** Validates `limitBy`; `ordered` is whether the query has a non-empty `orderBy`. */
export function validateLimitBy(
  kit: CalculationValidationKit,
  input: unknown,
  query: CalculationQueryShape,
  ordered: boolean,
): DataRecord {
  const value = kit.requireRecord(input, '$.limitBy');
  kit.exactFields(value, ['n', 'by'], [], '$.limitBy');
  const n = positiveInteger(value.n, '$.limitBy.n');
  const items = kit.arrayValue(value.by, '$.limitBy.by');
  if (items.length === 0) invalid('$.limitBy.by');
  const partitionable = new Set([...query.dimensions, ...(query.hasBy ? ['period'] : [])]);
  const seen = new Set<string>();
  const by = items.map((item, at) => {
    const path = `$.limitBy.by[${at}]`;
    const name = kit.identifier(item, path);
    if (!partitionable.has(name) || seen.has(name)) invalid(path);
    seen.add(name);
    return name;
  });
  // Without an order the kept rows would be arbitrary.
  if (!ordered) invalid('$.limitBy');
  return kit.freezeRecord({ n, by: Object.freeze(by) });
}

/** Validates `other`; `outputs` are calculation output names, which it may not rank by. */
export function validateOtherBucket(
  kit: CalculationValidationKit,
  input: unknown,
  query: CalculationQueryShape,
  outputs: readonly string[],
): DataRecord {
  const value = kit.requireRecord(input, '$.other');
  kit.exactFields(value, ['dimension', 'n', 'measure'], ['label'], '$.other');
  const dimension = kit.identifier(value.dimension, '$.other.dimension', false);
  if (!query.dimensions.includes(dimension)) invalid('$.other.dimension');
  const n = positiveInteger(value.n, '$.other.n', MAX_OTHER);
  const measure = kit.identifier(value.measure, '$.other.measure', false);
  if (outputs.includes(measure)) invalid('$.other.measure');
  const result: Record<string, unknown> = { dimension, n, measure };
  if (value.label !== undefined) {
    const label = kit.stringValue(value.label, '$.other.label');
    // eslint-disable-next-line no-control-regex
    if (label.length === 0 || [...label].length > MAX_LABEL || /[\u0000-\u001f\u007f]/.test(label)) {
      invalid('$.other.label');
    }
    result.label = label;
  }
  return kit.freezeRecord(result);
}
