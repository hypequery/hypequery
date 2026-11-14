import type { ProtocolDeploymentContract } from '@hypequery/protocol';

/**
 * The parts of `@hypequery/onboard-engine` the CLI calls. The engine is loaded
 * at runtime from the user's project (decision 0019 §5, amended), so it is not a
 * dependency and its types are not available at build time: these mirror the
 * engine's exports structurally and keep only the fields the CLI reads.
 */

export interface ClickHouseConnectionInput {
  readonly host: string;
  readonly database: string;
  readonly databases?: readonly string[];
  readonly username: string;
  readonly password: string;
}

export interface ClickHouseQueryOptions {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly deadlineMs?: number;
  readonly settings?: Readonly<Record<string, string | number>>;
  readonly params?: Readonly<Record<string, string>>;
}

export type ClickHouseQuery = (
  input: ClickHouseConnectionInput,
  sql: string,
  options: ClickHouseQueryOptions,
) => Promise<string>;

export type ClickHouseFailureKind = 'connection' | 'access' | 'query';

export type ClickHouseConnectionErrorClass = new (
  message: string,
  exceptionCode?: number,
  kind?: ClickHouseFailureKind,
) => Error & { readonly kind: ClickHouseFailureKind; readonly exceptionCode?: number };

export interface DiscoveredColumn {
  readonly name: string;
  readonly type: string;
  readonly comment: string;
  readonly supported: boolean;
  readonly stats?: { readonly distinct: number; readonly samples?: readonly string[] };
}

export interface DiscoveredTable {
  readonly name: string;
  readonly database?: string;
  readonly comment: string;
  readonly supported: boolean;
  readonly rows?: number;
  readonly engine?: string;
  readonly columns: readonly DiscoveredColumn[];
  readonly [key: string]: unknown;
}

export interface FirstPassFinding {
  readonly id: string;
  readonly table: string;
  readonly column?: string;
  readonly kind: string;
  readonly finding: string;
  readonly question?: string;
  readonly askBeforeDraft?: boolean;
  readonly [key: string]: unknown;
}

export interface DiscoveredSchema {
  readonly database: string;
  readonly databases?: readonly string[];
  readonly tables: readonly DiscoveredTable[];
  readonly truncated: boolean;
  readonly analysis?: {
    readonly findings: readonly FirstPassFinding[];
    readonly queries: number;
    readonly elapsedMs: number;
    readonly checkedTables: readonly string[];
    readonly skippedTables: readonly string[];
  };
  readonly grainChecks?: readonly GrainCheckResult[];
  readonly joinCandidates?: JoinCandidateReport;
  readonly [key: string]: unknown;
}

export interface ClickHouseAccessProfile {
  readonly readonly: 0 | 1 | 2;
  readonly [key: string]: unknown;
}

export interface ReadonlyAccessReport {
  readonly readonly: 0 | 1 | 2;
  readonly risks: readonly { readonly id: string; readonly [key: string]: unknown }[];
  readonly profileFix: string | null;
}

export type CheckQueryBounds =
  | { readonly kind: 'own' }
  | { readonly kind: 'profile' }
  | { readonly kind: 'unbounded'; readonly reason: string };

export interface ConnectionCapability {
  readonly id: 'tables' | 'columns' | 'parts' | 'database' | 'query-log';
  readonly target: string;
  readonly status: 'available' | 'missing' | 'unknown' | 'not-requested';
  readonly disabledChecks: readonly string[];
  readonly fix: string;
}

export interface GrainCheckResult {
  readonly id: string;
  readonly table: string;
  readonly status: 'passed' | 'finding' | 'skipped';
  readonly applicable?: boolean;
  readonly summary: string;
  readonly reason?: string;
  readonly [key: string]: unknown;
}

export interface JoinKey { readonly table: string; readonly column: string }

export interface JoinHint {
  readonly child: JoinKey;
  readonly parent: JoinKey;
  readonly source: 'query-history' | 'declared';
}

export interface JoinCandidate {
  readonly id: string;
  readonly child: JoinKey;
  readonly parent: JoinKey;
  readonly outcome: 'proposed' | 'rejected' | 'skipped';
  readonly reason: string;
  readonly [key: string]: unknown;
}

export interface JoinCandidateReport {
  readonly candidates: readonly JoinCandidate[];
  readonly omitted: number;
  readonly skippedTables?: readonly string[];
  readonly [key: string]: unknown;
}

export type JoinQuery = (sql: string, timeoutMs: number, limits?: unknown) => Promise<string>;

export interface JoinCheck {
  readonly child: JoinKey;
  readonly parent: JoinKey;
  readonly status: 'measured' | 'skipped';
  readonly reason: string;
  readonly [key: string]: unknown;
}

export interface HistoryConsent {
  readonly enabled: boolean;
  readonly revision: number;
  readonly connectionFingerprint: string;
  readonly serviceAccounts: readonly string[];
}

export interface QueryHistoryReport {
  readonly status: 'observed' | 'skipped';
  readonly reason?: string;
  readonly [key: string]: unknown;
}

export interface ColumnRoleHint {
  readonly table: string;
  readonly column: string;
  readonly candidates: readonly { readonly role: string; readonly score: number; readonly evidence: string }[];
  readonly ambiguous: boolean;
  readonly kind: 'metadata-hint';
}

export interface SamplePolicy {
  readonly mode: 'all' | 'detected' | 'none';
  readonly overrides: readonly { readonly table: string; readonly column: string; readonly send: boolean }[];
}

export interface MeasureCheck {
  readonly id?: string;
  readonly dataset: string;
  readonly measure?: string;
  readonly check?: string;
  readonly outcome: 'passed' | 'failed' | 'skipped';
  readonly applicable?: boolean;
  readonly reason?: string;
  readonly [key: string]: unknown;
}

type Contract = ProtocolDeploymentContract;

/** Every engine module the CLI imports, by subpath export. */
export interface OnboardEngineModules {
  readonly 'clickhouse-query': {
    readonly ClickHouseConnectionError: ClickHouseConnectionErrorClass;
  };
  readonly 'access-profile': {
    readonly ACCESS_PROFILE_QUERY: string;
    readonly parseAccessProfile: (body: string) => ClickHouseAccessProfile | null;
    readonly readonlyAccessReport: (profile: ClickHouseAccessProfile, username: string) => ReadonlyAccessReport;
    readonly checkQueryBounds: (profile: ClickHouseAccessProfile) => CheckQueryBounds;
  };
  readonly 'connection-capabilities': {
    readonly checkConnectionCapabilities: (
      input: ClickHouseConnectionInput,
      query: ClickHouseQuery,
      profile: ClickHouseAccessProfile,
      options?: { includeQueryLog?: boolean },
    ) => Promise<ConnectionCapability[]>;
  };
  readonly introspection: {
    readonly discoverSchema: (input: ClickHouseConnectionInput, query: ClickHouseQuery) => Promise<DiscoveredSchema>;
  };
  readonly 'grain-check-runner': {
    readonly verifyGrainChecks: (
      input: ClickHouseConnectionInput,
      query: ClickHouseQuery,
      schema: DiscoveredSchema,
      tables: readonly string[],
    ) => Promise<DiscoveredSchema>;
  };
  readonly 'join-candidate-runner': {
    readonly verifyJoinCandidates: (
      input: ClickHouseConnectionInput,
      query: ClickHouseQuery,
      schema: DiscoveredSchema,
      tables: readonly string[],
      hints?: readonly JoinHint[],
    ) => Promise<JoinCandidateReport>;
    readonly boundedJoinQuery: (input: ClickHouseConnectionInput, query: ClickHouseQuery) => Promise<JoinQuery>;
  };
  readonly 'join-check': {
    readonly checkJoin: (
      schema: DiscoveredSchema,
      request: { child: JoinKey; parent: JoinKey },
      query: JoinQuery,
    ) => Promise<JoinCheck>;
    readonly joinCheckSummary: (check: JoinCheck) => string;
    readonly joinProblem: (check: JoinCheck | undefined) => string | null;
  };
  readonly 'query-history': {
    readonly inspectQueryHistory: (
      input: ClickHouseConnectionInput,
      query: ClickHouseQuery,
      schema: DiscoveredSchema,
      consent: HistoryConsent,
    ) => Promise<QueryHistoryReport>;
    readonly queryHistoryContext: (report: QueryHistoryReport, schema: DiscoveredSchema) => Record<string, unknown> | null;
  };
  readonly 'column-roles': {
    readonly columnRoleHints: (table: DiscoveredTable, contract: Contract) => ColumnRoleHint[];
  };
  readonly 'sample-policy': {
    readonly schemaForAssistant: (schema: DiscoveredSchema, policy?: SamplePolicy) => DiscoveredSchema;
  };
  readonly 'measure-checks': {
    readonly verifyMeasures: (
      input: ClickHouseConnectionInput,
      query: ClickHouseQuery,
      schema: DiscoveredSchema,
      contract: Contract,
    ) => Promise<MeasureCheck[]>;
  };
  readonly 'field-column': {
    readonly resolveFieldColumn: (dataset: Contract['datasets'][number], field: string) => string | null;
  };
}

export type OnboardEngineSubpath = keyof OnboardEngineModules;

export const ONBOARD_ENGINE_SUBPATHS = [
  'clickhouse-query',
  'access-profile',
  'connection-capabilities',
  'introspection',
  'grain-check-runner',
  'join-candidate-runner',
  'join-check',
  'query-history',
  'column-roles',
  'sample-policy',
  'measure-checks',
  'field-column',
] as const satisfies readonly OnboardEngineSubpath[];

/** A loaded engine: its modules, and where and which version it came from. */
export interface OnboardEngine {
  readonly version: string;
  readonly directory: string;
  /** `project`: the user's node_modules; `cli`: beside the CLI (`npx -p`). */
  readonly from: 'project' | 'cli';
  readonly modules: OnboardEngineModules;
}
