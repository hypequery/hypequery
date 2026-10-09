import { createTelemetryEvent } from '../src/utils/telemetry/validation.js';
import { common, completed } from './fixtures.js';
import { updateCommandTelemetry } from '../src/utils/telemetry/command-context.js';

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
// @ts-expect-error Events that are not emitted yet are not in the catalog.
createTelemetryEvent({ event: 'cli_session_started', properties: { ...common, command: 'dev' } });
