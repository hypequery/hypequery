import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { createDatasetClient, dataset, dimension, divide, measure, nullIfZero, subtract } from '../../index.js';
import { TEST_CONNECTION_CONFIG as config, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';

/**
 * The cross-language window and shift corpus (RFC 0015). TypeScript is the
 * reference: `HYPEQUERY_UPDATE_CORPUS=1` rewrites each case's `expected`, and
 * Python's `test_time_measures_corpus_live.py` must reproduce them.
 */
const CORPUS_PATH = new URL('../../../../../specs/datasets/time-measures-corpus-v1.json', import.meta.url);
const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
const updating = process.env.HYPEQUERY_UPDATE_CORPUS === '1';

type Formula = string | { op: 'subtract' | 'divide' | 'nullIfZero'; args: Formula[] };

const FORMULAS = { subtract, divide, nullIfZero } as const;

function formulaNames(formula: Formula): string[] {
  return typeof formula === 'string' ? [formula] : formula.args.flatMap(formulaNames);
}

function buildFormula(formula: Formula, refs: Record<string, unknown>): any {
  if (typeof formula === 'string') return refs[formula];
  return (FORMULAS[formula.op] as (...args: unknown[]) => unknown)(...formula.args.map(arg => buildFormula(arg, refs)));
}

function corpusMeasure(definition: any): any {
  if (definition.kind === 'derived') {
    const names = [...new Set(formulaNames(definition.formula))];
    return measure.derived({
      uses: Object.fromEntries(names.map(name => [name, name])),
      formula: (refs: Record<string, unknown>) => buildFormula(definition.formula, refs),
    } as any);
  }
  if (definition.kind === 'shift') return measure.shift(definition.measure, definition.interval);
  if (definition.kind === 'window') {
    if (definition.trailing) return measure.trailing(definition.measure, definition.trailing);
    if (definition.toDate) return measure.toDate(definition.measure, definition.toDate);
    return measure.cumulative(definition.measure);
  }
  return (measure as any)[definition.aggregation](definition.field);
}

function corpusDataset(name: string, definition: any): any {
  return dataset(name, {
    source: definition.source,
    timeKey: definition.timeKey,
    ...(definition.tenantKey ? { tenantKey: definition.tenantKey } : {}),
    dimensions: Object.fromEntries(Object.entries(definition.dimensions).map(([field, spec]: [string, any]) => [
      field,
      (dimension as any)[spec.type](spec.column ? { column: spec.column } : undefined),
    ])),
    measures: Object.fromEntries(Object.entries(definition.measures).map(([field, spec]) => [field, corpusMeasure(spec)])),
  } as any);
}

const datasets = Object.fromEntries(Object.entries(corpus.datasets).map(([name, definition]) => [name, corpusDataset(name, definition)]));
const db = createQueryBuilder({ host: config.host, username: config.user, password: config.password, database: config.database });
const client = createDatasetClient({ queryBuilder: db });

async function run(testCase: any): Promise<unknown> {
  const context = testCase.tenant ? { runtime: { tenant: { id: testCase.tenant } } } : undefined;
  try {
    const result = await client.execute(datasets[testCase.dataset], testCase.query, context as any);
    return { rows: result.data };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

describe('window and shift corpus against ClickHouse', () => {
  beforeAll(async () => {
    for (const [table, { columns, rows }] of Object.entries(corpus.tables) as [string, any][]) {
      await runSql(`DROP TABLE IF EXISTS ${table}`);
      await runSql(`CREATE TABLE ${table} ${columns}`);
      await insertRows(table, rows);
    }
  });
  afterAll(async () => {
    for (const table of Object.keys(corpus.tables)) await runSql(`DROP TABLE IF EXISTS ${table}`);
    if (updating) writeFileSync(CORPUS_PATH, `${JSON.stringify(corpus, null, 2)}\n`);
  });

  for (const testCase of corpus.cases) {
    it(testCase.name, async () => {
      const actual = await run(testCase);
      if (updating) testCase.expected = actual;
      else expect(actual).toEqual(testCase.expected);
    });
  }
});
