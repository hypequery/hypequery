import type {
  ProtocolDatasetDerivedMeasure,
  ProtocolDatasetDimension,
  ProtocolDatasetFilter,
  ProtocolDatasetMeasure,
  ProtocolDeploymentDataset,
  ProtocolExpression,
  ProtocolSchema,
  ProtocolSemanticMetadata,
  ProtocolSqlExpression,
} from '@hypequery/protocol';

import { SEMANTIC_FILTER_OPERATORS } from '../constants.js';
import { stableStringify } from '../utils/canonical-json.js';
import { ContractExportError } from './errors.js';
import { formulaSource } from './formula-source.js';
import { call, code, literal, type Code } from './utils/source-writer.js';

/**
 * One dataset of a deployment contract as a `dataset()` definition.
 *
 * This is `protocol-adapter.ts` run backwards, field by field, and it writes
 * only what that adapter would not default: a column named like its
 * dimension, `filterable: true`, or the filters every filterable dimension
 * gets anyway are left out, as an author would leave them out. Anything the
 * authoring API can't reproduce exactly is refused (`ContractExportError`).
 */

export interface DatasetSource {
  readonly code: string;
  /** Names imported from `@hypequery/datasets`. */
  readonly imports: ReadonlySet<string>;
}

const METADATA_KEYS = ['examples', 'synonyms', 'format', 'unit', 'currency', 'sensitivity'] as const;

/** The forward adapter's output schema for a SQL-backed field of this type. */
function fieldSchema(type: string | undefined): ProtocolSchema {
  switch (type) {
    case 'string':
    case 'timestamp':
      return { kind: 'string' };
    case 'number':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    default:
      return { kind: 'any' };
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

/** `options` when any of its values is set, else `undefined`: `dimension.string()` over `dimension.string({})`. */
function present(options: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.values(options).some(value => value !== undefined) ? options : undefined;
}

/** A filter value as authored: plain where the forward adapter tags it the same way. */
function filterValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const tagged = (value as { $hypequery?: { type?: string; values?: unknown[] } }).$hypequery;
  if (tagged?.type === 'array' && Array.isArray(tagged.values)
    && tagged.values.every(item => item === null || typeof item !== 'object')) {
    return tagged.values;
  }
  // Any other tagged value is passed through unchanged by the adapter.
  return value;
}

export function datasetSource(
  dataset: ProtocolDeploymentDataset,
  constants: ReadonlyMap<string, string>,
  /** Datasets declared above this one in the file. */
  earlier: ReadonlySet<string>,
): DatasetSource {
  const name = String(dataset.name);
  const imports = new Set<string>(['dataset']);
  const refuse = (feature: string, detail: string) => new ContractExportError(name, feature, detail);
  const dimensionTypes = new Map(dataset.dimensions.map(item => [String(item.name), item.type]));

  const metadata = (item: ProtocolSemanticMetadata, subject: string) => {
    if (item.timezone !== undefined) {
      throw refuse(subject, 'semantic timezone metadata has no dataset() equivalent');
    }
    return Object.fromEntries(
      METADATA_KEYS.filter(key => item[key] !== undefined).map(key => [key, item[key]]),
    );
  };

  const sql = (expression: ProtocolSqlExpression, expected: ProtocolSchema, subject: string) => {
    if (expression.dialect !== 'clickhouse' || !sameJson(expression.output, expected)) {
      throw refuse(subject, 'its SQL expression has an output type or dialect code does not produce');
    }
    return { sql: expression.sql, dependencies: expression.dependencies.map(String) };
  };

  const dimension = (item: ProtocolDatasetDimension): Code => {
    imports.add('dimension');
    const dimensionName = String(item.name);
    const subject = `dimension "${dimensionName}"`;
    const source = item.source.kind === 'column'
      ? item.source.column === dimensionName ? {} : { column: item.source.column }
      : sql(item.source, fieldSchema(item.type), subject);
    const options = {
      label: item.label,
      description: item.description,
      ...source,
      ...(item.filterable ? {} : { filterable: false }),
      ...(item.groupable ? {} : { groupable: false }),
      ...metadata(item, subject),
    };
    return call(`dimension.${item.type}`, [present(options)], '    ');
  };

  const baseMeasure = (item: ProtocolDatasetMeasure): Code => {
    imports.add('measure');
    const measureName = String(item.name);
    const subject = `measure "${measureName}"`;
    const field = String(item.field);
    const filters = item.filters.map((expression, index) => measureFilter(expression, subject, index));
    const sqlOptions = item.sql === undefined
      ? {}
      : sql(item.sql, fieldSchema(dimensionTypes.get(field)), subject);
    const options = {
      label: item.label,
      description: item.description,
      ...sqlOptions,
      ...(filters.length > 0 ? { filters } : {}),
      ...metadata(item, subject),
    };
    const opts = present(options);
    const noFiltersOrSql = (helper: string) => {
      if (filters.length > 0 || item.sql !== undefined) {
        throw refuse(subject, `measure.${helper} can't carry fixed filters or SQL`);
      }
    };
    if (item.level !== undefined && item.aggregation !== 'percentile') {
      throw refuse(subject, `a level on ${item.aggregation} has no dataset() equivalent`);
    }
    switch (item.aggregation) {
      case 'merge':
        noFiltersOrSql('merge');
        if (item.stateFunction === undefined) throw refuse(subject, 'a merge needs its state function');
        return call('measure.merge', [item.stateFunction, field, opts], '    ');
      case 'argMax':
      case 'argMin':
        if (filters.length > 0) throw refuse(subject, `measure.${item.aggregation} can't carry fixed filters`);
        if (item.argField === undefined) throw refuse(subject, `${item.aggregation} needs its argument field`);
        return call(`measure.${item.aggregation}`, [field, String(item.argField), opts], '    ');
      case 'percentile':
        if (item.level === undefined) throw refuse(subject, 'a percentile needs its level');
        return item.level === 0.5
          ? call('measure.median', [field, opts], '    ')
          : call('measure.percentile', [field, item.level, opts], '    ');
      default:
        if (item.argField !== undefined || item.stateFunction !== undefined) {
          throw refuse(subject, `extra fields on ${item.aggregation} have no dataset() equivalent`);
        }
        return call(`measure.${item.aggregation}`, [field, opts], '    ');
    }
  };

  const measureFilter = (expression: ProtocolExpression, subject: string, index: number) => {
    if (expression.kind !== 'comparison' || expression.left.kind !== 'reference') {
      throw refuse(subject, `fixed filter ${index} is not a field/operator/value comparison`);
    }
    const field = String(expression.left.name);
    if (!('right' in expression) || expression.right === undefined) {
      return { field, operator: expression.operator };
    }
    if (expression.right.kind !== 'literal') {
      throw refuse(subject, `fixed filter ${index} compares with something other than a value`);
    }
    return { field, operator: expression.operator, value: filterValue(expression.right.value) };
  };

  const derivedMeasure = (item: ProtocolDatasetDerivedMeasure): Code => {
    imports.add('measure');
    const subject = `measure "${String(item.name)}"`;
    const aliases = item.uses.map(use => String(use.alias));
    const formula = formulaSource(item.expression, aliases, reason => refuse(subject, reason));
    for (const helper of formula.helpers) imports.add(helper);
    return call('measure.derived', [{
      uses: Object.fromEntries(item.uses.map(use => [String(use.alias), String(use.measure)])),
      formula: code(formula.code),
      label: item.label,
      description: item.description,
      ...metadata(item, subject),
    }], '    ');
  };

  const filters = (): Record<string, unknown> | undefined => {
    const derived = dataset.dimensions
      .filter(item => item.filterable)
      .map(item => ({ name: String(item.name), field: String(item.name), operators: [...SEMANTIC_FILTER_OPERATORS] }));
    const actual = dataset.filters.map(item => ({ ...item, name: String(item.name), field: String(item.field) }));
    if (sameJson(actual, derived)) return undefined;
    return Object.fromEntries(dataset.filters.map((item: ProtocolDatasetFilter) => [String(item.name), {
      __type: 'filter_definition',
      field: String(item.field),
      ...(sameJson(item.operators, SEMANTIC_FILTER_OPERATORS) ? {} : { operators: [...item.operators] }),
      label: item.label,
      description: item.description,
      ...metadata(item, `filter "${String(item.name)}"`),
    }]));
  };

  const relationships = () => {
    if (dataset.relationships.length === 0) return undefined;
    return Object.fromEntries(dataset.relationships.map(item => {
      const subject = `relationship "${String(item.name)}"`;
      if (item.queryable !== (item.kind !== 'hasMany')) {
        throw refuse(subject, `a ${item.queryable ? 'queryable' : 'non-queryable'} ${item.kind} has no dataset() equivalent`);
      }
      const target = constants.get(String(item.target));
      if (target === undefined) throw refuse(subject, `its target "${String(item.target)}" is not in the contract`);
      imports.add(item.kind);
      const join = item.keys !== undefined
        ? { keys: item.keys.map(key => ({ from: String(key.from), to: String(key.to) })) }
        : { from: String(item.from), to: String(item.to) };
      // A target declared further down (a cycle, or this dataset itself) can't
      // be inferred while this one is: TypeScript needs the arrow's type.
      const ahead = !earlier.has(String(item.target));
      if (ahead) imports.add('type AnyDatasetInstance');
      const arrow = ahead ? `(): AnyDatasetInstance => ${target}` : `() => ${target}`;
      return [String(item.name), call(item.kind, [code(arrow), join], '    ')];
    }));
  };

  const derivedMeasures = dataset.measures.filter(
    (item): item is ProtocolDatasetDerivedMeasure => 'kind' in item && item.kind === 'derived',
  );
  const baseMeasures = dataset.measures.filter(
    (item): item is ProtocolDatasetMeasure => !('kind' in item),
  );
  // Base measures, then derived ones: the order the forward adapter lists them in.
  const measures = [
    ...baseMeasures.map(item => [String(item.name), baseMeasure(item)] as const),
    ...derivedMeasures.map(item => [String(item.name), derivedMeasure(item)] as const),
  ];

  const config = {
    source: dataset.source,
    description: dataset.description,
    ...metadata(dataset, 'the dataset'),
    rowResolution: dataset.rowResolution,
    freshness: dataset.freshness,
    owner: dataset.owner,
    tenantKey: dataset.tenant.kind === 'required' ? dataset.tenant.field : undefined,
    timeKey: dataset.timeField === undefined ? undefined : String(dataset.timeField),
    defaults: dataset.defaults,
    dimensions: Object.fromEntries(dataset.dimensions.map(item => [String(item.name), dimension(item)])),
    measures: measures.length > 0 ? Object.fromEntries(measures) : undefined,
    filters: filters(),
    relationships: relationships(),
    limits: dataset.limits,
  };
  const constant = constants.get(name) as string;
  return {
    code: `export const ${constant} = dataset(${literal(name)}, ${literal(config)});\n`,
    imports,
  };
}

