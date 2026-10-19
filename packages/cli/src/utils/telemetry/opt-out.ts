import { TelemetryConfigStore, type TelemetryConfigDependencies } from './config-store.js';
import type { TelemetryConfig } from './config-schema.js';
import { getCliVersion } from '../cli-version.js';

export type TelemetrySource = 'flag' | 'DO_NOT_TRACK' | 'HYPEQUERY_TELEMETRY_DISABLED'
  | 'test' | 'hypequery_ci' | 'config' | 'default' | 'config_unavailable' | 'kill_switch';

export interface TelemetryState {
  readonly enabled: boolean;
  readonly source: TelemetrySource;
  readonly config: TelemetryConfig | null;
}

export interface TelemetryResolutionOptions extends TelemetryConfigDependencies {
  readonly telemetry?: boolean;
  readonly cliVersion?: string;
}

/** First matching opt-out wins; customer CI is intentionally eligible. */
export function telemetryOptOutSource(
  options: TelemetryResolutionOptions,
): TelemetrySource | null {
  const env = options.env ?? process.env;
  if (options.telemetry === false) return 'flag';
  if (env.DO_NOT_TRACK === '1') return 'DO_NOT_TRACK';
  if (env.HYPEQUERY_TELEMETRY_DISABLED === '1') return 'HYPEQUERY_TELEMETRY_DISABLED';
  if (env.VITEST || env.NODE_ENV === 'test') return 'test';
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY?.toLowerCase() === 'hypequery/hypequery') {
    return 'hypequery_ci';
  }
  return null;
}

export async function resolveTelemetryState(
  options: TelemetryResolutionOptions = {},
): Promise<TelemetryState> {
  const store = new TelemetryConfigStore(options);
  const source = telemetryOptOutSource(options);
  if (source) return { enabled: false, source, config: await store.peek() };
  const existing = await store.peek();
  const config = await store.load();
  if (!config) return { enabled: false, source: 'config_unavailable', config: null };
  if (config.disabled_cli_versions?.includes(options.cliVersion ?? getCliVersion())) {
    return { enabled: false, source: 'kill_switch', config };
  }
  return { enabled: config.enabled, source: existing ? 'config' : 'default', config };
}
