import { CliError } from '../utils/machine-output/cli-error.js';
import { TelemetryConfigStore } from '../utils/telemetry/config-store.js';
import { TELEMETRY_DOCS_URL } from '../utils/telemetry/config-schema.js';
import { resolveTelemetryState, type TelemetryResolutionOptions } from '../utils/telemetry/opt-out.js';

/** `hypequery telemetry --json`. */
export interface TelemetryCommandResult {
  readonly action: 'status' | 'enable' | 'disable';
  readonly enabled: boolean;
  readonly source: string;
  readonly installId: string | null;
  readonly docsUrl: string;
}

export async function telemetryCommand(
  action = 'status',
  options: TelemetryResolutionOptions = {},
): Promise<TelemetryCommandResult> {
  if (!['status', 'enable', 'disable'].includes(action)) {
    throw new CliError('USAGE', 'Usage: hypequery telemetry [status|enable|disable]');
  }
  if (action !== 'status') {
    const config = await new TelemetryConfigStore(options).setEnabled(action === 'enable');
    if (!config) {
      throw new Error('Could not save telemetry settings. To disable for this run, set HYPEQUERY_TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1, or pass --no-telemetry.');
    }
    console.log(`Telemetry ${config.enabled ? 'enabled' : 'disabled'} in saved settings.`);
  }
  const state = await resolveTelemetryState(options);
  console.log(`Telemetry: ${state.enabled ? 'enabled' : 'disabled'} (source: ${state.source})`);
  console.log(`Install ID: ${state.config?.install_id ?? 'unavailable'}`);
  console.log(`Learn more: ${TELEMETRY_DOCS_URL}`);
  return {
    action: action as TelemetryCommandResult['action'],
    enabled: state.enabled,
    source: state.source,
    installId: state.config?.install_id ?? null,
    docsUrl: TELEMETRY_DOCS_URL,
  };
}
