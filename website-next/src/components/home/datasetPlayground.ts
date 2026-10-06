/**
 * Runs the homepage "Define & query" example against a small in-memory
 * `orders` table, so edits to the dataset or the execute call update the
 * result. It understands a deliberately small subset of the TypeScript and
 * Python dataset APIs; anything else is reported as an error.
 */

export type PlaygroundLanguage = 'typescript' | 'python';

type Aggregation = 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max';

type Row = Record<string, string | number>;

export type PlaygroundResult =
  | { ok: true; columns: { name: string; measure: boolean }[]; rows: string[][]; totalRows: number }
  | { ok: false; error: string };

type DatasetDefinition = {
  name: string;
  source: string;
  dimensions: Map<string, string>;
  measures: Map<string, { aggregation: Aggregation; field: string }>;
};

type PlaygroundQuery = {
  dimensions: string[];
  measures: string[] | null;
  limit: number | null;
};

const COUNTRIES = ['GB', 'US', 'DE', 'FR', 'NZ', 'CA'];
const CHANNELS = ['web', 'mobile', 'partner'];
const STATUSES = ['completed', 'completed', 'completed', 'refunded', 'pending'];
const PLANS = ['starter', 'growth', 'enterprise'];

function buildSampleOrders(): Row[] {
  // Deterministic pseudo-random rows so the example result is stable.
  let seed = 42;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: 120 }, (_, index) => {
    const country = COUNTRIES[Math.floor(next() * COUNTRIES.length)];
    const plan = PLANS[Math.floor(next() * PLANS.length)];
    const base = plan === 'enterprise' ? 900 : plan === 'growth' ? 300 : 80;
    const month = String(1 + Math.floor(next() * 6)).padStart(2, '0');
    const day = String(1 + Math.floor(next() * 28)).padStart(2, '0');
    return {
      id: `ord_${1000 + index}`,
      customer_id: `cus_${100 + Math.floor(next() * 40)}`,
      country,
      channel: CHANNELS[Math.floor(next() * CHANNELS.length)],
      status: STATUSES[Math.floor(next() * STATUSES.length)],
      plan,
      amount: Math.round(base + next() * base),
      quantity: 1 + Math.floor(next() * 5),
      created_at: `2026-${month}-${day}`,
    };
  });
}

export const SAMPLE_ORDERS = buildSampleOrders();
export const SAMPLE_COLUMNS = Object.keys(SAMPLE_ORDERS[0]);
const MAX_DISPLAY_ROWS = 8;

function stringList(source: string | undefined): string[] {
  if (source === undefined) return [];
  return [...source.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

/** Text of the balanced `{...}` block that starts at or after `from`. */
function braceBlock(code: string, from: number): string | null {
  const start = code.indexOf('{', from);
  if (start === -1) return null;
  let depth = 0;
  for (let index = start; index < code.length; index += 1) {
    if (code[index] === '{') depth += 1;
    if (code[index] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start + 1, index);
    }
  }
  return null;
}

/** Text of the balanced `(...)` call that starts at `open`. */
function parenBlock(code: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '(') depth += 1;
    if (code[index] === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, index);
    }
  }
  return null;
}

function keyedBlock(code: string, key: RegExp): string | null {
  const match = key.exec(code);
  return match ? braceBlock(code, match.index + match[0].length - 1) : null;
}

const TS_AGGREGATIONS: Record<string, Aggregation> = {
  sum: 'sum', count: 'count', countDistinct: 'countDistinct', avg: 'avg', min: 'min', max: 'max',
};
const PY_AGGREGATIONS: Record<string, Aggregation> = {
  sum: 'sum', sum_: 'sum', count: 'count', count_distinct: 'countDistinct', avg: 'avg',
  min: 'min', min_: 'min', max: 'max', max_: 'max',
};

function parseTypeScript(code: string): { dataset: DatasetDefinition; query: PlaygroundQuery } | string {
  const datasetMatch = /dataset\(\s*['"]([^'"]+)['"]\s*,/.exec(code);
  if (!datasetMatch) return 'Define a dataset with dataset(\'orders\', { ... }).';
  const body = braceBlock(code, datasetMatch.index + datasetMatch[0].length);
  if (body === null) return 'The dataset definition is missing a closing brace.';

  const dimensions = new Map<string, string>();
  for (const match of (keyedBlock(body, /dimensions\s*:\s*\{/) ?? '').matchAll(/(\w+)\s*:\s*dimension\.(\w+)\(([^)]*)\)/g)) {
    const column = /column\s*:\s*['"]([^'"]+)['"]/.exec(match[3])?.[1];
    dimensions.set(match[1], column ?? match[1]);
  }
  const measures = new Map<string, { aggregation: Aggregation; field: string }>();
  for (const match of (keyedBlock(body, /measures\s*:\s*\{/) ?? '').matchAll(/(\w+)\s*:\s*measure\.(\w+)\(\s*['"]([^'"]+)['"]/g)) {
    const aggregation = TS_AGGREGATIONS[match[2]];
    if (!aggregation) return `measure.${match[2]} is not supported in this example. Try sum, count, countDistinct, avg, min, or max.`;
    measures.set(match[1], { aggregation, field: match[3] });
  }

  const executeMatch = /\.execute\(\s*\w+\s*,/.exec(code);
  if (!executeMatch) return 'Run the dataset with analytics.execute(orders, { ... }).';
  const args = braceBlock(code, executeMatch.index + executeMatch[0].length) ?? '';
  const limit = /limit\s*:\s*(\d+)/.exec(args)?.[1];
  const measureList = /measures\s*:\s*\[([^\]]*)\]/.exec(args);
  return {
    dataset: { name: datasetMatch[1], source: /source\s*:\s*['"]([^'"]+)['"]/.exec(body)?.[1] ?? datasetMatch[1], dimensions, measures },
    query: {
      dimensions: stringList(/dimensions\s*:\s*\[([^\]]*)\]/.exec(args)?.[1]),
      measures: measureList ? stringList(measureList[1]) : null,
      limit: limit ? Number(limit) : null,
    },
  };
}

function parsePython(code: string): { dataset: DatasetDefinition; query: PlaygroundQuery } | string {
  const datasetMatch = /Dataset\(/.exec(code);
  if (!datasetMatch) return 'Define a dataset with Dataset(name="orders", ...).';
  const body = parenBlock(code, datasetMatch.index + datasetMatch[0].length - 1);
  if (body === null) return 'The Dataset(...) call is missing a closing parenthesis.';
  const name = /name\s*=\s*['"]([^'"]+)['"]/.exec(body)?.[1];
  if (!name) return 'Give the dataset a name, for example name="orders".';

  const dimensions = new Map<string, string>();
  for (const match of (keyedBlock(body, /dimensions\s*=\s*\{/) ?? '').matchAll(/['"](\w+)['"]\s*:\s*dimension\(([^)]*)\)/g)) {
    const column = /column\s*=\s*['"]([^'"]+)['"]/.exec(match[2])?.[1];
    dimensions.set(match[1], column ?? match[1]);
  }
  const measures = new Map<string, { aggregation: Aggregation; field: string }>();
  for (const match of (keyedBlock(body, /measures\s*=\s*\{/) ?? '').matchAll(/['"](\w+)['"]\s*:\s*measure\(\s*(\w+)\(\s*['"]([^'"]+)['"]/g)) {
    const aggregation = PY_AGGREGATIONS[match[2]];
    if (!aggregation) return `${match[2]}() is not supported in this example. Try sum, count, count_distinct, avg, min, or max.`;
    measures.set(match[1], { aggregation, field: match[3] });
  }

  const executeMatch = /\.execute\(/.exec(code);
  if (!executeMatch) return 'Run the dataset with analytics.execute(orders, { ... }).';
  const args = parenBlock(code, executeMatch.index + executeMatch[0].length - 1) ?? '';
  const list = (key: string) =>
    new RegExp(`['"]${key}['"]\\s*:\\s*[\\[(]([^\\])]*)[\\])]`).exec(args)
    ?? new RegExp(`\\b${key}\\s*=\\s*[\\[(]([^\\])]*)[\\])]`).exec(args);
  const limit = /['"]?limit['"]?\s*[:=]\s*(\d+)/.exec(args)?.[1];
  const measureList = list('measures');
  return {
    dataset: { name, source: /source\s*=\s*['"]([^'"]+)['"]/.exec(body)?.[1] ?? name, dimensions, measures },
    query: {
      dimensions: stringList(list('dimensions')?.[1]),
      measures: measureList ? stringList(measureList[1]) : null,
      limit: limit ? Number(limit) : null,
    },
  };
}

function aggregate(rows: Row[], aggregation: Aggregation, field: string): number {
  const values = rows.map((row) => row[field]);
  switch (aggregation) {
    case 'count': return values.length;
    case 'countDistinct': return new Set(values).size;
    case 'sum': return values.reduce<number>((total, value) => total + Number(value), 0);
    case 'avg': return values.reduce<number>((total, value) => total + Number(value), 0) / values.length;
    case 'min': return Math.min(...values.map(Number));
    case 'max': return Math.max(...values.map(Number));
  }
}

function formatValue(value: number, aggregation: Aggregation, field: string): string {
  const money = field === 'amount' && aggregation !== 'count' && aggregation !== 'countDistinct';
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: aggregation === 'avg' ? 2 : 0 }).format(value);
  return money ? `$${formatted}` : formatted;
}

export function runPlayground(code: string, language: PlaygroundLanguage): PlaygroundResult {
  const parsed = language === 'typescript' ? parseTypeScript(code) : parsePython(code);
  if (typeof parsed === 'string') return { ok: false, error: parsed };
  const { dataset, query } = parsed;

  if (dataset.source !== 'orders') {
    return { ok: false, error: `Table "${dataset.source}" is not in this example. Use source "orders".` };
  }
  for (const [name, column] of dataset.dimensions) {
    if (!SAMPLE_COLUMNS.includes(column)) return { ok: false, error: `Dimension "${name}" maps to column "${column}", which is not in the orders table.` };
  }
  for (const [name, { field }] of dataset.measures) {
    if (!SAMPLE_COLUMNS.includes(field)) return { ok: false, error: `Measure "${name}" aggregates column "${field}", which is not in the orders table.` };
  }

  const available = (names: Iterable<string>) => [...names].join(', ') || 'none';
  for (const name of query.dimensions) {
    if (!dataset.dimensions.has(name)) {
      return { ok: false, error: `Unknown dimension "${name}" on dataset "${dataset.name}". Available: ${available(dataset.dimensions.keys())}` };
    }
  }
  const measures = query.measures ?? [...dataset.measures.keys()];
  for (const name of measures) {
    if (!dataset.measures.has(name)) {
      return { ok: false, error: `Unknown measure "${name}" on dataset "${dataset.name}". Available: ${available(dataset.measures.keys())}` };
    }
  }
  if (query.dimensions.length === 0 && measures.length === 0) {
    return { ok: false, error: 'Select at least one dimension or measure.' };
  }

  const groups = new Map<string, Row[]>();
  for (const row of SAMPLE_ORDERS) {
    const key = query.dimensions.map((name) => String(row[dataset.dimensions.get(name)!])).join('\u0000');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const results = [...groups.values()].map((rows) => ({
    keys: query.dimensions.map((name) => String(rows[0][dataset.dimensions.get(name)!])),
    values: measures.map((name) => {
      const { aggregation, field } = dataset.measures.get(name)!;
      return { raw: aggregate(rows, aggregation, field), aggregation, field };
    }),
  }));
  results.sort((a, b) => (measures.length > 0 ? b.values[0].raw - a.values[0].raw : a.keys.join().localeCompare(b.keys.join())));

  const limited = query.limit !== null ? results.slice(0, query.limit) : results;
  return {
    ok: true,
    columns: [
      ...query.dimensions.map((name) => ({ name, measure: false })),
      ...measures.map((name) => ({ name, measure: true })),
    ],
    rows: limited.slice(0, MAX_DISPLAY_ROWS).map((result) => [
      ...result.keys,
      ...result.values.map(({ raw, aggregation, field }) => formatValue(raw, aggregation, field)),
    ]),
    totalRows: limited.length,
  };
}
