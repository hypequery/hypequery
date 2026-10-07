import { TELEMETRY_DOCS_URL } from './config-schema.js';
import { TelemetryConfigStore, type TelemetryConfigDependencies } from './config-store.js';

export const TELEMETRY_NOTICE = [
  'Hypequery collects pseudonymous CLI usage to prioritise the roadmap.',
  'Never code, SQL, names, paths or credentials.',
  'Disable: hypequery telemetry disable, HYPEQUERY_TELEMETRY_DISABLED=1, or DO_NOT_TRACK=1.',
  `Details: ${TELEMETRY_DOCS_URL}`,
  '',
].join('\n');

export interface NoticeOptions extends TelemetryConfigDependencies {
  readonly enabled: boolean;
  readonly command: string;
  readonly isTTY: boolean;
  readonly isCI: boolean;
  readonly write?: (text: string) => Promise<void>;
}

export async function showTelemetryNotice(options: NoticeOptions): Promise<void> {
  if (!options.enabled || !options.isTTY || options.isCI || options.command === 'mcp' || options.command === 'telemetry') return;
  try {
    await new TelemetryConfigStore(options).showNotice(async () => {
      if (options.write) await options.write(TELEMETRY_NOTICE);
      else await new Promise<void>((resolve, reject) => {
        process.stderr.write(TELEMETRY_NOTICE, error => error ? reject(error) : resolve());
      });
    });
  } catch { /* A failed disclosure write must not affect the command. */ }
}
