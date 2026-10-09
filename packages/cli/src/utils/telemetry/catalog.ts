import { COMMANDS, COMMAND_FLAGS, COUNT_BUCKETS, DATABASES, DURATION_BUCKETS, ERROR_CODES, GLOBAL_FLAGS, HYPEQUERY_PACKAGES, OUTCOMES } from './domains.js';
import { boolean, enumeration, enumList, fieldsFor, formatted, optional, record, type Fields, type Properties } from './schema.js';

const count = (description: string) => enumeration(description, COUNT_BUCKETS);
export const EVENT_SCHEMA_VERSION = 1;
const stages = ['started', 'database_selected', 'connection_tested', 'style_selected', 'files_written', 'dependencies_installed', 'completed'] as const;

export const COMMON_PROPERTIES = {
  schema_version: enumeration('Which event contract does this payload use?', [EVENT_SCHEMA_VERSION]),
  cli_version: formatted('Which CLI releases are in use?', 'version'),
  node_version: formatted('Which Node major.minor releases need support?', 'node_version'),
  os: enumeration('Which operating systems need support?', ['darwin', 'linux', 'win32', 'aix', 'freebsd', 'openbsd', 'sunos', 'android', 'unknown']),
  arch: enumeration('Which CPU architectures need support?', ['arm', 'arm64', 'ia32', 'x64', 'loong64', 'mips', 'mipsel', 'ppc', 'ppc64', 'riscv64', 's390', 's390x', 'unknown']),
  is_ci: boolean('How much usage happens in CI?'),
  ci_name: enumeration('Which CI providers need support?', ['none', 'github_actions', 'gitlab', 'circleci', 'buildkite', 'jenkins', 'vercel', 'netlify', 'azure', 'bitbucket', 'teamcity', 'travis', 'codebuild', 'unknown']),
  is_tty: boolean('How much usage is interactive?'),
  is_docker: boolean('How much usage runs in containers?'),
  is_wsl: boolean('How much usage runs in WSL?'),
  package_manager: enumeration('Which package managers need support?', ['npm', 'pnpm', 'yarn', 'bun', 'unknown']),
  package_manager_major: optional(formatted('Which package-manager major releases need support?', 'major_version')),
  invoked_via: enumeration('How is the CLI invoked?', ['npx', 'pnpm_dlx', 'bunx', 'global', 'local_bin', 'unknown']),
  install_id: formatted('Count active installations without hardware or account identifiers.', 'uuid'),
  project_id: optional(formatted('Count active projects across installations; omit when no signal exists.', 'hash')),
  session_id: formatted('Group events from the same invocation.', 'uuid'),
  is_first_run: boolean('How many installations are new?'),
  hypequery_packages: optional(record('Which toolkit packages and exact versions are adopted? No project dependencies or names.', fieldsFor(HYPEQUERY_PACKAGES, optional(formatted('Installed exact release version, or unknown.', 'version'))))),
  database: enumeration('Which database backends merit investment?', DATABASES),
} as const satisfies Fields;

/** Command-specific completion fields; absence means that stage was not reached. */
export const COMMAND_PROPERTIES = {
  init: {
    stage_reached: optional(enumeration('Where does onboarding stop?', stages)),
    failed_stage: optional(enumeration('Which onboarding stage needs reliability work?', stages)),
    style: optional(enumeration('Which scaffold style is adopted?', ['queries', 'datasets'])),
    auth: optional(enumeration('Is context authentication adopted?', ['none', 'context'])),
    interactive: optional(boolean('How much onboarding is interactive?')),
    force: optional(boolean('How often are scaffold files overwritten?')),
    example: optional(boolean('Are example queries requested?')),
    skip_connection: optional(boolean('Are offline scaffolds used?')),
    connection_result: optional(enumeration('Where does connection setup fail?', ['ok', 'failed', 'skipped'])),
    chdb_failure_reason: optional(enumeration('Does embedded onboarding fail at installation or execution?', ['not_installed', 'engine_error'])),
    table_count_bucket: optional(count('How large are onboarding schemas?')),
    datasets_generated_bucket: optional(count('How many datasets are scaffolded?')),
    table_selection: optional(enumeration('Which table-selection workflows are used?', ['all', 'list', 'exclude', 'prompt'])),
    env_file: optional(enumeration('Does onboarding create or update environment config?', ['created', 'updated', 'unchanged', 'skipped'])),
    gitignore: optional(enumeration('Does onboarding create or update ignore config?', ['created', 'updated', 'unchanged', 'skipped'])),
    package_json_present: optional(boolean('Does onboarding start in an existing project?')),
    analytics_directory_present: optional(boolean('Does onboarding reuse an analytics directory?')),
  },
  // Other commands report only the common completion fields until they are
  // instrumented; each instrumentation change adds its command's fields here.
  ...Object.fromEntries(COMMANDS.filter(command => command !== 'init' && command !== 'help').map(command => [command, {}])) as Record<Exclude<typeof COMMANDS[number], 'init' | 'help'>, Record<string, never>>,
  help: { help_topic: optional(enumeration('Which command help needs improvement? Unknown input becomes unknown.', ['root', ...COMMANDS])) },
} as const satisfies Record<typeof COMMANDS[number], Fields>;

export const EVENT_CATALOG = {
  cli_command_completed: {
    purpose: 'Measure command adoption, onboarding drop-off and release reliability. Exactly once per invocation; never emit for telemetry disable.',
    properties: {
      command: enumeration('Which known command was requested? Raw unknown input is never retained.', COMMANDS),
      flags_used: enumList('Which documented flags are adopted? Canonical names only, never values.', [...new Set([...Object.values(COMMAND_FLAGS).flat(), ...GLOBAL_FLAGS])]),
      outcome: enumeration('Which commands fail, succeed or are aborted?', OUTCOMES),
      duration_bucket: enumeration('Which commands need performance work?', DURATION_BUCKETS),
      error_code: optional(enumeration('Which known failures need reliability work?', ERROR_CODES)),
    },
    variants: COMMAND_PROPERTIES,
  },
  cli_crash: {
    purpose: 'Measure uncaught failures by stable class and code, with no messages or stacks.',
    properties: {
      command: enumeration('Which command crashed?', COMMANDS),
      exception_class: enumeration('Which built-in exception classes need investigation?', ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError', 'unknown']),
      error_code: enumeration('Which known failure caused the crash?', ERROR_CODES),
    },
  },
} as const;

export type TelemetryEventName = keyof typeof EVENT_CATALOG;
type Definition<N extends TelemetryEventName> = typeof EVENT_CATALOG[N];
type VariantProperties<V extends Record<string, Fields>> = {
  [C in keyof V]: { command: C } & Properties<V[C]>;
}[keyof V];
type CompletionFlags = {
  [C in keyof typeof COMMAND_FLAGS]: { command: C; flags_used: readonly (typeof COMMAND_FLAGS[C][number] | typeof GLOBAL_FLAGS[number])[] };
}[keyof typeof COMMAND_FLAGS];
export type TelemetryProperties<N extends TelemetryEventName> = Properties<typeof COMMON_PROPERTIES>
  & Properties<Definition<N>['properties']>
  & (Definition<N> extends { variants: infer V extends Record<string, Fields> } ? VariantProperties<V> : unknown)
  & (N extends 'cli_command_completed' ? CompletionFlags : unknown);
export type TelemetryEvent = {
  [N in TelemetryEventName]: { readonly event: N; readonly properties: TelemetryProperties<N> };
}[TelemetryEventName];
