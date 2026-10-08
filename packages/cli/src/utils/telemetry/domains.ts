/** Stable domains: never populate these from user-provided names or messages. */
export const COUNT_BUCKETS = ['0', '1', '2-5', '6-20', '21-100', '101+'] as const;
export const DURATION_BUCKETS = ['<100ms', '100ms-1s', '1s-10s', '10s-1m', '1m-10m', '10m-1h', '1h+'] as const;
export const ERROR_CODES = [
  'unknown', 'connection_failed', 'auth_failed', 'entrypoint_not_found', 'compile_error',
  'prompt_cancelled', 'validation_failed', 'cloud_network_error', 'cloud_rejected',
  'not_installed', 'engine_error', 'no_tables', 'no_datasets', 'tenant_required',
  'load_error', 'output_missing', 'output_out_of_date', 'unknown_command', 'unknown_option',
] as const;
export const OUTCOMES = ['success', 'failure', 'cancelled', 'interrupted'] as const;
export const DATABASES = ['clickhouse', 'chdb', 'bigquery', 'unknown'] as const;
export const COMMANDS = [
  'init', 'dev', 'mcp', 'generate', 'generate:types', 'generate:datasets',
  'generate:manifest', 'login', 'logout', 'deploy', 'deployment:build',
  'deployment:validate', 'deployment:release', 'deployment:submit', 'deployment:status',
  'pull', 'diff', 'help', 'version', 'telemetry', 'unknown',
] as const;
export type TelemetryCommand = typeof COMMANDS[number];

/** Canonical long names, including negated flags. Values and aliases never leave the CLI. */
export const COMMAND_FLAGS = {
  init: ['--path', '--style', '--database', '--chdb-path', '--auth', '--all-tables', '--tables', '--exclude-tables', '--no-example', '--no-interactive', '--force', '--skip-connection'],
  dev: ['--port', '--hostname', '--no-watch', '--no-cache', '--cache', '--redis-url', '--open', '--cors', '--path', '--quiet'],
  mcp: ['--path', '--tenant', '--self-test', '--url'],
  generate: ['--output', '--path', '--tables', '--database', '--chdb-path'],
  'generate:types': ['--output', '--path', '--tables', '--database', '--chdb-path'],
  'generate:datasets': ['--output', '--path', '--tables', '--exclude-tables', '--tenant-column', '--force', '--check', '--diff'],
  'generate:manifest': ['--output'],
  login: ['--cloud-url', '--environment'],
  logout: [],
  deploy: ['--bundle-output', '--release-output', '--project', '--environment', '--no-source', '--endpoint', '--replace-restored', '--mcp-config'],
  'deployment:build': ['--bundle-output', '--no-source'],
  'deployment:validate': [],
  'deployment:release': ['--project', '--environment', '--output'],
  'deployment:submit': ['--release', '--endpoint', '--replace-restored'],
  'deployment:status': ['--project', '--environment', '--endpoint', '--mcp-config'],
  pull: ['--output', '--project', '--environment', '--endpoint'],
  diff: ['--project', '--environment', '--endpoint'],
  help: [], version: [], telemetry: [], unknown: [],
} as const satisfies Record<TelemetryCommand, readonly string[]>;
export const GLOBAL_FLAGS = ['--no-telemetry', '--help', '--version'] as const;
/** Options that consume the next argument as their value; that value is never a flag. */
export const VALUE_FLAGS = {
  init: ['--path', '--style', '--database', '--chdb-path', '--auth', '--tables', '--exclude-tables'],
  dev: ['--port', '--hostname', '--cache', '--redis-url', '--path'],
  mcp: ['--path', '--tenant', '--url'],
  generate: ['--output', '--path', '--tables', '--database', '--chdb-path'],
  'generate:types': ['--output', '--path', '--tables', '--database', '--chdb-path'],
  'generate:datasets': ['--output', '--path', '--tables', '--exclude-tables', '--tenant-column'],
  'generate:manifest': ['--output'],
  login: ['--cloud-url', '--environment'],
  logout: [],
  deploy: ['--bundle-output', '--release-output', '--project', '--environment', '--endpoint'],
  'deployment:build': ['--bundle-output'],
  'deployment:validate': [],
  'deployment:release': ['--project', '--environment', '--output'],
  'deployment:submit': ['--release', '--endpoint'],
  'deployment:status': ['--project', '--environment', '--endpoint'],
  pull: ['--output', '--project', '--environment', '--endpoint'],
  diff: ['--project', '--environment', '--endpoint'],
  help: [], version: [], telemetry: [], unknown: [],
} as const satisfies { [C in TelemetryCommand]: readonly typeof COMMAND_FLAGS[C][number][] };
export type TelemetryFlag = typeof COMMAND_FLAGS[TelemetryCommand][number] | typeof GLOBAL_FLAGS[number];
export const SHORT_FLAGS = { '-o': '--output', '-p': '--port', '-h': '--hostname', '-q': '--quiet', '-V': '--version' } as const;
export const HYPEQUERY_PACKAGES = ['@hypequery/clickhouse', '@hypequery/datasets', '@hypequery/serve', '@hypequery/react', '@hypequery/cli', '@hypequery/mcp', '@hypequery/protocol', '@hypequery/protocol-conformance', '@hypequery/deployment'] as const;
