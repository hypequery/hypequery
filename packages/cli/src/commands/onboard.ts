import path from 'node:path';
import { CliError } from '../utils/cli-error.js';
import { logger } from '../utils/logger.js';
import { emitResult } from '../utils/machine-output.js';
import { terminalText } from '../utils/terminal-text.js';
import { unscopedTenantCandidates } from '../utils/tenant-key-candidates.js';
import type { ClickHouseQuery, ColumnRoleHint, DiscoveredSchema, JoinCandidate, JoinCandidateReport, JoinCheck, MeasureCheck } from '../utils/onboard/engine-types.js';
import { connectionFingerprint } from '../utils/onboard/onboard-connection.js';
import { loadOnboardContract } from '../utils/onboard/onboard-contract.js';
import { declaredJoins, parseJoinPairs, type JoinToCheck } from '../utils/onboard/onboard-joins.js';
import {
  EMPTY_CONTRACT,
  parseList,
  partitionIdShown,
  SAMPLE_MODES,
  samplePolicy,
  selectTables,
  tenantKeyCandidates,
  withoutCustomerOnly,
  withPolicyPartition,
  withPolicySplit,
  type OnboardWarning,
  type SampleMode,
} from '../utils/onboard/onboard-report.js';
import {
  connectionInfo,
  discover,
  engineInfo,
  openOnboardSession,
  readAccessProfile,
  type OnboardSession,
  type OnboardSessionDependencies,
} from '../utils/onboard/onboard-session.js';

export interface OnboardOptions {
  /** Databases beyond CLICKHOUSE_DATABASE, comma-separated. */
  databases?: string;
  /** Tables to analyse (comma-separated); default: every supported table. */
  tables?: string;
  /** Which sampled column values reports carry: detected (default), none or all. */
  samples?: string;
  /** Commander's `--no-query-history`: false skips reading system.query_log. */
  queryHistory?: boolean;
  /** `onboard check`: extra joins to measure, `child.column=parent.column`, comma-separated. */
  join?: string;
}

export type OnboardDependencies = OnboardSessionDependencies;

const ONBOARD_USAGE = 'Usage: hypequery onboard analyze [--tables a,b] [--no-query-history] | hypequery onboard check [datasets-file] [--join child.col=parent.col]';
const SCHEMA_USAGE = 'Usage: hypequery schema inspect [--databases a,b] [--tables a,b] [--samples detected|none|all]';

function sampleMode(value: string | undefined): SampleMode {
  if (value === undefined) return 'detected';
  if ((SAMPLE_MODES as readonly string[]).includes(value)) return value as SampleMode;
  throw new CliError('USAGE', `Unknown --samples ${value}; use ${SAMPLE_MODES.join(', ')}.`, { hint: 'Pass --samples detected, none or all.' });
}

/** Text from ClickHouse or the engine, for the terminal: see {@link terminalText}. */
const shown = (value: unknown) => terminalText(String(value));

function warn(warnings: readonly OnboardWarning[]) {
  for (const warning of warnings) {
    logger.warn(shown(warning.message));
    if (warning.hint) logger.indent(shown(warning.hint));
  }
}

/** Whether a table's partition IDs may appear in a report under `mode`. */
function partitionsShown(session: OnboardSession, schema: DiscoveredSchema, mode: SampleMode) {
  return partitionIdShown(schema, mode, session.engine.modules['sample-policy'].withheldBy(schema, samplePolicy(mode)));
}

/** Discovery as an agent may read it, optionally narrowed to some tables. */
function inspectedSchema(session: OnboardSession, schema: DiscoveredSchema, mode: SampleMode, tables: readonly string[] | undefined) {
  const safe = session.engine.modules['sample-policy'].schemaForAssistant(schema, samplePolicy(mode));
  const { analysis: _analysis, columnRoleHints: _hints, ...rest } = safe as DiscoveredSchema & { columnRoleHints?: unknown };
  void _analysis;
  void _hints;
  const partitions = partitionsShown(session, schema, mode);
  const all = rest.tables.map(table => withPolicyPartition(table, table.name, partitions));
  return { ...rest, tables: tables ? all.filter(table => tables.includes(table.name)) : all };
}

/** `hypequery schema inspect`: tables, columns, engine metadata and sampled column stats. */
export async function schemaCommand(action: string | undefined, options: OnboardOptions = {}, dependencies: OnboardDependencies = {}): Promise<void> {
  if (action !== 'inspect') throw new CliError('USAGE', SCHEMA_USAGE);
  if (options.join || options.queryHistory === false) throw new CliError('USAGE', `--join and --no-query-history apply to onboard, not schema inspect. ${SCHEMA_USAGE}`);
  const mode = sampleMode(options.samples);
  const session = await openOnboardSession('schema inspect', options, dependencies);
  const warnings: OnboardWarning[] = [];
  await readAccessProfile(session);
  const schema = await discover(session);
  const { tables, unknown } = selectTables(schema, parseList(options.tables));
  if (unknown.length) warnings.push({ code: 'UNKNOWN_TABLES', message: `Not found or not supported: ${unknown.join(', ')}.` });
  if (schema.truncated) warnings.push({ code: 'SCHEMA_TRUNCATED', message: 'The schema is larger than discovery reads; some tables or columns are missing.', hint: 'Narrow it with --databases, or set CLICKHOUSE_DATABASE.' });

  const inspected = inspectedSchema(session, schema, mode, parseList(options.tables) ? tables : undefined);
  logger.header('hypequery schema inspect');
  logger.success(shown(`${connectionInfo(session.input).host} · ${schema.tables.length} tables (engine ${session.engine.version})`));
  for (const table of inspected.tables) {
    const rows = table.rows === undefined ? '' : `, ${table.rows.toLocaleString('en-US')} rows`;
    logger.info(shown(`${table.name}  ${table.engine ?? 'unknown engine'}${rows}, ${table.columns.length} columns${table.supported ? '' : ' (unsupported)'}`));
  }
  warn(warnings);
  emitResult({
    engine: engineInfo(session.engine),
    connection: connectionInfo(session.input),
    schema: inspected,
    warnings,
  });
}

export async function onboardCommand(
  action: string | undefined,
  source: string | undefined,
  options: OnboardOptions = {},
  dependencies: OnboardDependencies = {},
): Promise<void> {
  if (action === 'analyze') {
    if (source !== undefined || options.join) throw new CliError('USAGE', `onboard analyze takes no file and no --join. ${ONBOARD_USAGE}`);
    return onboardAnalyze(options, dependencies);
  }
  if (action === 'check') {
    if (options.tables || options.samples || options.queryHistory === false) {
      throw new CliError('USAGE', `--tables, --samples and --no-query-history apply to onboard analyze. ${ONBOARD_USAGE}`);
    }
    return onboardCheck(source, options, dependencies);
  }
  throw new CliError('USAGE', ONBOARD_USAGE);
}

function columnRoles(session: OnboardSession, schema: DiscoveredSchema, tables: readonly string[]): ColumnRoleHint[] {
  const roles = session.engine.modules['column-roles'];
  return schema.tables
    .filter(table => tables.includes(table.name))
    .flatMap(table => roles.columnRoleHints(table, EMPTY_CONTRACT))
    .filter(hint => hint.candidates.length > 0);
}

/**
 * `hypequery onboard analyze`: the analysis Cloud's onboarding runs, against
 * the project's own ClickHouse. Observations only: it proposes, the user and
 * the agent decide, and nothing is written.
 */
async function onboardAnalyze(options: OnboardOptions, dependencies: OnboardDependencies): Promise<void> {
  const mode = sampleMode(options.samples);
  const history = options.queryHistory !== false;
  const session = await openOnboardSession('onboard analyze', options, dependencies);
  const { engine, input, query } = session;
  const warnings: OnboardWarning[] = [];
  const profile = await readAccessProfile(session);
  const access = engine.modules['access-profile'].readonlyAccessReport(profile, input.username);
  const capabilities = await engine.modules['connection-capabilities'].checkConnectionCapabilities(input, query, profile, { includeQueryLog: history });
  for (const capability of capabilities) {
    if (capability.status === 'missing' && capability.id !== 'query-log') {
      warnings.push({ code: 'GRANT_MISSING', message: `No SELECT on ${capability.target}: ${capability.disabledChecks.join('; ')} won't run.`, hint: capability.fix });
    }
  }

  const discovered = await discover(session);
  const { tables, unknown } = selectTables(discovered, parseList(options.tables));
  if (unknown.length) warnings.push({ code: 'UNKNOWN_TABLES', message: `Not found or not supported: ${unknown.join(', ')}.` });
  if (discovered.truncated) warnings.push({ code: 'SCHEMA_TRUNCATED', message: 'The schema is larger than discovery reads; some tables or columns are missing.', hint: 'Narrow it with --databases, or set CLICKHOUSE_DATABASE.' });

  const [grained, joins, historyReport] = await Promise.all([
    engine.modules['grain-check-runner'].verifyGrainChecks(input, query, discovered, tables),
    engine.modules['join-candidate-runner'].verifyJoinCandidates(input, query, discovered, tables),
    history
      ? engine.modules['query-history'].inspectQueryHistory(input, query, discovered, {
        enabled: true,
        revision: 1,
        connectionFingerprint: connectionFingerprint(input),
        serviceAccounts: [],
      })
      : Promise.resolve(null),
  ]);

  // Query history is optional evidence: without its grant the analysis still succeeds.
  const queryLog = capabilities.find(capability => capability.id === 'query-log');
  let queryHistory: Record<string, unknown>;
  if (!historyReport) {
    queryHistory = { status: 'skipped', reason: 'Skipped with --no-query-history.' };
  } else if (historyReport.status === 'observed') {
    queryHistory = engine.modules['query-history'].queryHistoryContext(historyReport, discovered)
      ?? { status: 'skipped', reason: 'The schema changed while query history was read.' };
  } else {
    queryHistory = { status: 'skipped', reason: historyReport.reason ?? 'Query history was unavailable.' };
    warnings.push({
      code: 'QUERY_HISTORY_UNAVAILABLE',
      message: queryLog?.status === 'missing'
        ? `Query history was not read: this user has no SELECT on system.query_log. ${historyReport.reason ?? ''}`.trim()
        : `Query history was not read. ${historyReport.reason ?? ''}`.trim(),
      hint: queryLog?.status === 'missing'
        ? `Optional: ${queryLog.fix} Then rerun to see which joins and filters queries already use.`
        : 'Optional: query history only adds hints; the rest of the analysis is complete.',
    });
  }

  const schema = inspectedSchema(session, grained, mode, undefined);
  const safeAnalysis = engine.modules['sample-policy'].schemaForAssistant(grained, samplePolicy(mode)).analysis;
  const findings = safeAnalysis?.findings ?? [];
  const candidates = tenantKeyCandidates(discovered);
  const partitions = partitionsShown(session, discovered, mode);
  const report = {
    engine: engineInfo(engine),
    connection: {
      ...connectionInfo(input),
      readonly: access.readonly,
      risks: access.risks,
      profileFix: access.profileFix,
      capabilities,
    },
    tables,
    schema,
    findings,
    questions: findings.filter(finding => finding.question).map(finding => ({
      id: finding.id,
      table: finding.table,
      ...(finding.column ? { column: finding.column } : {}),
      question: finding.question,
      askBeforeDraft: finding.askBeforeDraft === true,
    })),
    grainChecks: (grained.grainChecks ?? []).map(check => withPolicyPartition(withoutCustomerOnly(check), check.table, partitions)),
    joinCandidates: joinReport(joins, splitValuesShown(session, discovered, mode), partitions),
    columnRoles: columnRoles(session, discovered, tables),
    queryHistory,
    tenantKeyCandidates: {
      note: 'Names that look like a tenant boundary. Ask the user which column (if any) scopes each table; never set tenantKey from this list.',
      candidates,
    },
    warnings,
  };

  printAnalysis(report);
  warn(warnings);
  emitResult(report);
}

/**
 * Whether a report may carry a column's values in a join split: when the
 * column's type declares them (Enum, Bool), or when the sample policy lets
 * the column's samples out.
 */
function splitValuesShown(session: OnboardSession, schema: DiscoveredSchema, mode: SampleMode) {
  const withheld = session.engine.modules['sample-policy'].withheldBy(schema, samplePolicy(mode));
  const { declaredValues } = session.engine.modules['join-sql'];
  return (table: string, column: string) => {
    const found = schema.tables.find(item => item.name === table)?.columns.find(item => item.name === column);
    return Boolean(found && declaredValues(found)) || !withheld(table, column);
  };
}

function joinReport(
  report: JoinCandidateReport,
  valuesShown: (table: string, column: string) => boolean,
  partitions: (table: string) => boolean,
) {
  return {
    // A join's sample scope is the child table's.
    candidates: report.candidates.map(candidate =>
      withPolicyPartition(withPolicySplit(withoutCustomerOnly(candidate), valuesShown), candidate.child.table, partitions)),
    omitted: report.omitted,
    ...(report.skippedTables?.length ? { skippedTables: report.skippedTables } : {}),
  };
}

function printAnalysis(report: {
  connection: { host: string; readonly?: number; risks?: readonly unknown[] };
  tables: readonly string[];
  findings: readonly { finding: string; table: string }[];
  grainChecks: readonly { status: string; table: string; summary: string }[];
  queryHistory: Record<string, unknown>;
  tenantKeyCandidates: { candidates: readonly { table: string; column: string }[] };
  joinCandidates: { candidates: readonly JoinCandidate[] };
}) {
  logger.header('hypequery onboard analyze');
  logger.success(shown(`${report.connection.host} · ${report.tables.length} tables analysed`
    + (report.connection.readonly === undefined ? '' : ` · readonly = ${report.connection.readonly}`)));
  if (report.connection.risks?.length) logger.warn(`${report.connection.risks.length} settings-profile risk(s); see connection.profileFix in --json.`);
  if (report.findings.length) {
    logger.info('Findings:');
    for (const finding of report.findings.slice(0, 20)) logger.indent(shown(`${finding.table}: ${finding.finding}`));
  }
  for (const check of report.grainChecks.filter(item => item.status === 'finding')) logger.indent(shown(`${check.table}: ${check.summary}`));
  // The report's candidates, not the engine's: a withheld split's values are out of its reason.
  const proposed = report.joinCandidates.candidates.filter(candidate => candidate.outcome === 'proposed');
  if (proposed.length) {
    logger.info('Join candidates:');
    for (const candidate of proposed) logger.indent(shown(`${candidate.child.table}.${candidate.child.column} → ${candidate.parent.table}.${candidate.parent.column}: ${candidate.reason}`));
  }
  logger.info(shown(`Query history: ${String(report.queryHistory.status)}`));
  if (report.tenantKeyCandidates.candidates.length) {
    logger.info('Possible tenant columns (ask the user; never apply automatically):');
    logger.indent(shown(report.tenantKeyCandidates.candidates.map(item => `${item.table}.${item.column}`).join(', ')));
  }
  logger.info('Run with --json for the full report.');
}

/** The wall-clock budget for all of `onboard check`'s join checks together. */
export const CHECK_JOINS_BUDGET_MS = 90_000;

type CheckedJoin = JoinToCheck & Omit<Partial<JoinCheck>, 'status'> & {
  readonly status: JoinCheck['status'] | 'invalid';
  readonly summary: string;
  readonly problem: string | null;
};

type JoinStructure =
  | { readonly kind: 'ok' }
  | { readonly kind: 'invalid' | 'skipped'; readonly problem: string };

/**
 * Whether a join can be measured at all, from the discovered schema. A table
 * or column that doesn't exist, or keys of different types, can never join:
 * the model is wrong (`invalid`). An unsupported table or a key type the
 * engine can't measure is only unmeasured (`skipped`).
 */
function joinStructure(session: OnboardSession, schema: DiscoveredSchema, join: JoinToCheck): JoinStructure {
  const { keyColumn, keyFamily } = session.engine.modules['join-sql'];
  const keys = [];
  for (const side of [join.child, join.parent]) {
    const table = schema.tables.find(item => item.name === side.table);
    if (!table) return { kind: 'invalid', problem: `Table ${side.table} was not found in ClickHouse.` };
    const column = table.columns.find(item => item.name === side.column);
    if (!column) return { kind: 'invalid', problem: `${side.table} has no column ${side.column}.` };
    if (!table.supported) return { kind: 'skipped', problem: `${side.table} is not a table the checks can read, so the join wasn't measured.` };
    const key = keyColumn(table, side.column);
    if (!key) return { kind: 'skipped', problem: `${side.table}.${side.column} (${column.type}) is not a key type the checks can measure, so the join wasn't measured.` };
    keys.push(key);
  }
  const [child, parent] = keys as [NonNullable<typeof keys[number]>, NonNullable<typeof keys[number]>];
  if (keyFamily(child) !== keyFamily(parent)) {
    return {
      kind: 'invalid',
      problem: `${join.child.table}.${join.child.column} (${child.type}) and ${join.parent.table}.${join.parent.column} (${parent.type}) have different key types, so they can never match.`,
    };
  }
  return { kind: 'ok' };
}

/**
 * `hypequery onboard check`: verify a model's numbers and joins against the
 * data. Measure checks compare each measure with an independent route; join
 * checks measure every declared relationship (and `--join` pairs) for key
 * coverage, uniqueness and fan-out. Fails (exit 1) while any check fails.
 */
async function onboardCheck(source: string | undefined, options: OnboardOptions, dependencies: OnboardDependencies): Promise<void> {
  const extraJoins = parseJoinPairs(options.join);
  const loaded = await loadOnboardContract(source, dependencies.cwd);
  const session = await openOnboardSession('onboard check', options, dependencies);
  const { engine, input, query } = session;
  const warnings: OnboardWarning[] = [];
  await readAccessProfile(session);
  const schema = await discover(session);
  const { contract } = loaded;

  const known = new Set(schema.tables.map(table => table.name));
  // A SQL source (RFC 0028) reads its declared dependencies rather than one table.
  const sourceTables = contract.datasets.flatMap(dataset => (
    typeof dataset.source === 'string' ? [dataset.source] : dataset.source.dependencies.map(String)
  ));
  const missingSources = [...new Set(sourceTables)].filter(table => !known.has(table));

  const measureChecks: MeasureCheck[] = missingSources.length
    ? []
    : await engine.modules['measure-checks'].verifyMeasures(input, query, schema, contract);

  // One budget for every join together: each check also has the engine's own
  // per-check deadline, but a model with many relationships must still finish.
  const deadline = Date.now() + CHECK_JOINS_BUDGET_MS;
  const budgeted: ClickHouseQuery = (target, sql, queryOptions) =>
    query(target, sql, { ...queryOptions, deadlineMs: Math.min(queryOptions.deadlineMs ?? deadline, deadline) });
  const valuesShown = splitValuesShown(session, schema, 'detected');
  const partitions = partitionsShown(session, schema, 'detected');
  const joinChecker = engine.modules['join-check'];
  const toCheck: JoinToCheck[] = [...declaredJoins(contract, engine.modules['field-column'].resolveFieldColumn), ...extraJoins];
  const joinChecks: CheckedJoin[] = [];
  for (const join of toCheck) {
    const structure = joinStructure(session, schema, join);
    if (structure.kind !== 'ok') {
      joinChecks.push({ ...join, status: structure.kind, reason: structure.problem, summary: structure.problem, problem: structure.problem });
      continue;
    }
    if (Date.now() >= deadline) {
      const reason = `onboard check spent its ${CHECK_JOINS_BUDGET_MS / 1000} s join budget before reaching this join.`;
      joinChecks.push({ ...join, status: 'skipped', reason, summary: reason, problem: reason });
      continue;
    }
    const joinQuery = await engine.modules['join-candidate-runner'].boundedJoinQuery(input, budgeted);
    const check = await joinChecker.checkJoin(schema, { child: join.child, parent: join.parent }, joinQuery);
    joinChecks.push({
      ...join,
      ...withPolicyPartition(withPolicySplit(withoutCustomerOnly(check), valuesShown), join.child.table, partitions),
      summary: joinChecker.joinCheckSummary(check),
      problem: joinChecker.joinProblem(check),
    });
  }

  const unscoped = unscopedTenantCandidates(contract);
  for (const candidate of unscoped) {
    warnings.push({
      code: 'TENANT_KEY_UNSET',
      message: `${candidate.dataset} has no tenantKey but reads ${candidate.columns.join(', ')}.`,
      hint: 'Ask the user whether this dataset is scoped by tenant, and by which column. Never set tenantKey without their answer.',
    });
  }

  const failedMeasures = measureChecks.filter(check => check.outcome === 'failed');
  // A join whose table or column doesn't exist, or whose keys can never match,
  // is a mistake in the model; one the checks can't measure is only a warning.
  const failedJoins = joinChecks.filter(check => check.status === 'invalid' || (check.status === 'measured' && check.problem));
  const unmeasured = joinChecks.filter(check => check.status === 'skipped');
  for (const check of unmeasured) {
    warnings.push({ code: 'JOIN_NOT_MEASURED', message: `${check.child.table}.${check.child.column} → ${check.parent.table}.${check.parent.column}: ${check.problem ?? check.summary}` });
  }
  const summary = {
    measures: {
      passed: measureChecks.filter(check => check.outcome === 'passed').length,
      failed: failedMeasures.length,
      skipped: measureChecks.filter(check => check.outcome === 'skipped').length,
    },
    joins: { passed: joinChecks.length - failedJoins.length - unmeasured.length, failed: failedJoins.length, skipped: unmeasured.length },
  };
  const ok = missingSources.length === 0 && failedMeasures.length === 0 && failedJoins.length === 0;

  logger.header('hypequery onboard check');
  logger.success(shown(`${path.relative(process.cwd(), loaded.source) || loaded.source}: ${contract.datasets.length} datasets (${loaded.kind})`));
  logger.info(`Measures: ${summary.measures.passed} passed, ${summary.measures.failed} failed, ${summary.measures.skipped} skipped`);
  logger.info(`Joins: ${summary.joins.passed} passed, ${summary.joins.failed} failed, ${summary.joins.skipped} not measured`);
  for (const check of failedMeasures) logger.error(shown(`${check.dataset}.${check.measure ?? ''} (${check.check ?? 'check'}): ${check.reason ?? 'failed'}`));
  for (const check of failedJoins) logger.error(shown(`${check.child.table}.${check.child.column} → ${check.parent.table}.${check.parent.column}: ${check.problem}`));
  warn(warnings);

  if (!ok) {
    const issues = [
      ...missingSources.map(table => ({ path: `sources/${table}`, message: `Source table ${table} was not found in ClickHouse.` })),
      ...failedMeasures.map(check => ({
        path: `measures/${check.dataset}.${check.measure ?? ''}/${check.check ?? 'check'}`,
        message: check.reason ?? 'The measure check failed.',
      })),
      ...failedJoins.map(check => ({
        path: `joins/${check.relationship ?? `${check.child.table}.${check.child.column}=${check.parent.table}.${check.parent.column}`}`,
        message: check.problem ?? check.summary,
      })),
    ];
    throw new CliError('ONBOARD_CHECK_FAILED',
      `onboard check found ${issues.length} problem(s): ${issues.map(issue => `${issue.path}: ${issue.message}`).join(' | ')}`, {
        hint: 'Fix each issue in the datasets file (or ask the user where the data is ambiguous), then rerun `hypequery onboard check`.',
        issues,
      });
  }
  logger.success('All checks that could run passed.');
  emitResult({
    ok,
    engine: engineInfo(engine),
    connection: connectionInfo(input),
    source: { path: loaded.source, kind: loaded.kind, datasets: contract.datasets.map(dataset => dataset.name) },
    summary,
    measureChecks: measureChecks.map(withoutCustomerOnly),
    joinChecks,
    warnings,
  });
}
