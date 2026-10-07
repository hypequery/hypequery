import { matchesTelemetryFormat } from './value-formats.js';

export const TELEMETRY_SCHEMA_VERSION = 1;
export const TELEMETRY_DOCS_URL = 'https://hypequery.com/docs/telemetry';

export interface TelemetryConfig {
  readonly schema_version: typeof TELEMETRY_SCHEMA_VERSION;
  readonly enabled: boolean;
  readonly install_id: string;
  readonly notice_shown_at?: string;
  readonly disabled_cli_versions?: readonly string[];
}

/** Reject malformed or future settings rather than silently enabling telemetry. */
export function parseTelemetryConfig(input: string): TelemetryConfig | null {
  try {
    const value: unknown = JSON.parse(input);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const config = value as Partial<TelemetryConfig>;
    if (config.schema_version !== TELEMETRY_SCHEMA_VERSION
      || typeof config.enabled !== 'boolean'
      || typeof config.install_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(config.install_id)
      || (config.notice_shown_at !== undefined
        && (typeof config.notice_shown_at !== 'string'
          || !Number.isFinite(Date.parse(config.notice_shown_at))))
      || (config.disabled_cli_versions !== undefined
        && (!Array.isArray(config.disabled_cli_versions) || config.disabled_cli_versions.length > 20
          || !config.disabled_cli_versions.every(version => matchesTelemetryFormat('version', version))))) return null;
    return {
      schema_version: TELEMETRY_SCHEMA_VERSION,
      enabled: config.enabled,
      install_id: config.install_id,
      ...(config.notice_shown_at ? { notice_shown_at: config.notice_shown_at } : {}),
      ...(config.disabled_cli_versions ? { disabled_cli_versions: config.disabled_cli_versions } : {}),
    };
  } catch {
    return null;
  }
}
