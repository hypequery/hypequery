/**
 * `hypequery check`: compile representative queries for every dataset and
 * have the database plan them without running them. Missing columns, type
 * errors and SQL the engine can't run surface here instead of at query time.
 */

/** The parts of a dataset `check` reads. */
export interface CheckableDataset {
  readonly name?: string;
  readonly timeKey?: string;
  readonly tenantKey?: string;
  readonly dimensions: Readonly<Record<string, unknown>>;
  readonly measures: Readonly<Record<string, unknown>>;
  readonly relationships?: Readonly<Record<string, {
    readonly kind?: string;
    readonly target?: () => { readonly dimensions?: Readonly<Record<string, unknown>> };
  }>>;
}

export interface CompiledStatement {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/** What `compileDataset` returns, reduced to the statements a query runs. */
export interface CompiledCheckQuery extends CompiledStatement {
  readonly preflightStatements: readonly CompiledStatement[];
}

export type CompileQuery = (dataset: CheckableDataset, query: Readonly<Record<string, unknown>>) => CompiledCheckQuery;

/** Plan one statement without running it; returns advisory warnings, throws on an invalid plan. */
export type ExplainStatement = (statement: CompiledStatement) => Promise<readonly string[]>;

export interface CheckFinding {
  readonly label: string;
  readonly stage: 'compile' | 'plan';
  readonly message: string;
}

export interface DatasetCheckResult {
  readonly dataset: string;
  readonly queries: number;
  readonly failures: readonly CheckFinding[];
  readonly warnings: readonly string[];
}

/** The time grain used for the time-axis query and for measures that need one. */
const CHECK_GRAIN = 'month';

export async function checkDatasets(
  datasets: Readonly<Record<string, CheckableDataset>>,
  compile: CompileQuery,
  explain: ExplainStatement,
): Promise<DatasetCheckResult[]> {
  const results: DatasetCheckResult[] = [];
  for (const [key, dataset] of Object.entries(datasets)) {
    results.push(await checkDataset(key, dataset, compile, explain));
  }
  return results;
}

async function checkDataset(
  key: string,
  dataset: CheckableDataset,
  compile: CompileQuery,
  explain: ExplainStatement,
): Promise<DatasetCheckResult> {
  const failures: CheckFinding[] = [];
  const warnings = new Set<string>();
  let queries = 0;

  /** Compile, falling back to a time grain for measures that need one, then plan. */
  const run = async (label: string, query: Record<string, unknown>): Promise<boolean> => {
    let compiled: CompiledCheckQuery;
    try {
      compiled = compileWithGrainFallback(dataset, query, compile);
    } catch (error) {
      failures.push({ label, stage: 'compile', message: messageOf(error) });
      return false;
    }
    queries += 1;
    try {
      for (const statement of [...compiled.preflightStatements, compiled]) {
        for (const warning of await explain(statement)) warnings.add(warning);
      }
      return true;
    } catch (error) {
      failures.push({ label, stage: 'plan', message: messageOf(error) });
      return false;
    }
  };

  const plannable: string[] = [];
  for (const measure of Object.keys(dataset.measures)) {
    if (await run(`measure ${measure}`, { measures: [measure] })) plannable.push(measure);
  }
  // Dimensions are grouped under a measure that plans, so a broken measure
  // isn't reported again against every dimension.
  const withMeasure = plannable.length > 0 ? { measures: [plannable[0]] } : {};
  for (const dimension of [...Object.keys(dataset.dimensions), ...relatedDimensions(dataset)]) {
    await run(`dimension ${dimension}`, { dimensions: [dimension], ...withMeasure });
  }
  if (dataset.timeKey && plannable.length > 0) {
    await run(`time grain ${CHECK_GRAIN}`, { by: CHECK_GRAIN, ...withMeasure });
  }
  return { dataset: key, queries, failures, warnings: [...warnings] };
}

function compileWithGrainFallback(
  dataset: CheckableDataset,
  query: Record<string, unknown>,
  compile: CompileQuery,
): CompiledCheckQuery {
  try {
    return compile(dataset, query);
  } catch (error) {
    // Time measures need a time axis; try once with one before reporting.
    if (!dataset.timeKey || 'by' in query) throw error;
    try {
      return compile(dataset, { ...query, by: CHECK_GRAIN });
    } catch {
      throw error;
    }
  }
}

/** `relationship.dimension` for every to-one relationship; to-many traversal is refused by the planner. */
function relatedDimensions(dataset: CheckableDataset): string[] {
  const names: string[] = [];
  for (const [relationship, definition] of Object.entries(dataset.relationships ?? {})) {
    if (definition.kind === 'hasMany') continue;
    const target = definition.target?.();
    for (const dimension of Object.keys(target?.dimensions ?? {})) names.push(`${relationship}.${dimension}`);
  }
  return names;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
