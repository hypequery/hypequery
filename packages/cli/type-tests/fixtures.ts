import type { Properties } from '../src/utils/telemetry/schema.js';
import type { COMMON_PROPERTIES, TelemetryEvent } from '../src/utils/telemetry/catalog.js';

export const common = {
  schema_version: 1,
  cli_version: '1.22.0',
  node_version: '22.10',
  os: 'linux', arch: 'x64', is_ci: false, ci_name: 'none',
  is_tty: true, is_docker: false, is_wsl: false,
  package_manager: 'pnpm', package_manager_major: '10', invoked_via: 'local_bin',
  install_id: '643df3e7-070d-49d9-8048-852d59302146',
  session_id: '63fe5cfa-590f-41d5-872c-6635cfe8be06',
  is_first_run: false, database: 'clickhouse',
} as const satisfies Properties<typeof COMMON_PROPERTIES>;

export const completed = {
  event: 'cli_command_completed',
  properties: { ...common, command: 'init', flags_used: ['--style'], outcome: 'success', duration_bucket: '1s-10s', style: 'datasets' },
} as const satisfies TelemetryEvent;
