import { createTelemetryEvent } from '../src/utils/telemetry/validation.js';
import { common, completed } from './fixtures.js';
import { updateCommandTelemetry, startCommandSession } from '../src/utils/telemetry/command-context.js';

startCommandSession('mcp', { entry_type: 'api.ts', mode: 'serve', dataset_count_bucket: '1', tenant_used: false, tenant_dataset_count_bucket: '0' }, () => ({ tool_call_counts: { list: '0', describe: '0', query: '0' }, error_count_bucket: '0' } as const));
// @ts-expect-error MCP sessions require their tool counters.
startCommandSession('mcp', { entry_type: 'api.ts', mode: 'serve', dataset_count_bucket: '1', tenant_used: false, tenant_dataset_count_bucket: '0' }, () => ({ reload_count_bucket: '0', reload_error_count_bucket: '0', load_failures: {} }));

updateCommandTelemetry('init', { stage_reached: 'style_selected', style: 'datasets', database: 'chdb' });
// @ts-expect-error The command metrics boundary excludes raw paths.
updateCommandTelemetry('init', { path: '/private/project' });
// @ts-expect-error Cross-command metrics are not allowed.
updateCommandTelemetry('generate', { style: 'datasets' });
// @ts-expect-error Counters must be bucketed.
updateCommandTelemetry('init', { table_count_bucket: 12 });
// @ts-expect-error Failure reasons use closed enums.
updateCommandTelemetry('init', { chdb_failure_reason: 'private-engine-message' });

createTelemetryEvent(completed);
createTelemetryEvent({ event: 'cli_session_started', properties: {
  ...common, command: 'dev', entry_type: 'api.ts', watch: true,
  cache_provider: 'memory', cors: false, open: true, custom_port: false, quiet: false,
} });

const extra = { ...completed, properties: { ...completed.properties, path: '/private/project' } } as const;
// @ts-expect-error Variables with undeclared properties must be rejected too.
createTelemetryEvent(extra);

// @ts-expect-error Root fields are also exact.
createTelemetryEvent({ ...completed, message: 'private' });
// @ts-expect-error A different command cannot accept init fields.
createTelemetryEvent({ ...completed, properties: { ...completed.properties, command: 'generate' } });
// @ts-expect-error Unknown enums are not user-provided strings.
createTelemetryEvent({ ...completed, properties: { ...completed.properties, outcome: 'oops' } });
// @ts-expect-error Durations are bucketed, never raw numbers.
createTelemetryEvent({ ...completed, properties: { ...completed.properties, duration_bucket: 123 } });
// @ts-expect-error Unknown events cannot be constructed.
createTelemetryEvent({ ...completed, event: 'arbitrary_event' });
// @ts-expect-error Missing common fields cannot be emitted.
createTelemetryEvent({ event: 'cli_crash', properties: { command: 'unknown', error_code: 'unknown', exception_class: 'Error' } });
// @ts-expect-error Only known package names are allowed, including nested extras on variables.
createTelemetryEvent({ ...completed, properties: { ...completed.properties, hypequery_packages: { '@hypequery/cli': '1.22.0', private_project: '1.0.0' } } });
// @ts-expect-error Raw flags with values are not flag names.
createTelemetryEvent({ ...completed, properties: { ...completed.properties, flags_used: ['--style=secret'] } });
// @ts-expect-error Known flags from another command are also forbidden.
createTelemetryEvent({ ...completed, properties: { ...completed.properties, flags_used: ['--tenant'] } });
// @ts-expect-error Session variants require their own counters.
createTelemetryEvent({ event: 'cli_session_ended', properties: { ...common, command: 'mcp', outcome: 'interrupted', duration_bucket: '1h+' } });
// @ts-expect-error MCP handshake identity is deliberately excluded pending review.
createTelemetryEvent({ event: 'cli_session_started', properties: { ...common, command: 'mcp', entry_type: 'api.ts', mode: 'serve', dataset_count_bucket: '1', tenant_used: true, tenant_dataset_count_bucket: '1', client_name: 'private-client' } });
