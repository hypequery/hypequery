import type { ClickHouseSettings } from '../../types/clickhouse-settings.js';
import type { ArrowCompression } from '../query-builder.js';
import { isReadonlySettingError } from './readonly-setting-error.js';

const ARROW_COMPRESSION = 'output_format_arrow_compression_method';

export interface ArrowStreamSettingsAttempt {
  settings: ClickHouseSettings;
  adapterDefaultApplied: boolean;
}

function hasCompressionSetting(settings?: ClickHouseSettings): boolean {
  return settings !== undefined && Object.prototype.hasOwnProperty.call(settings, ARROW_COMPRESSION);
}

/**
 * Applies the adapter's uncompressed-batches default without overriding
 * connection-level or per-call settings, and records whether the final value
 * belongs to the adapter.
 */
export function buildArrowStreamSettings(
  compression: ArrowCompression,
  configSettings?: ClickHouseSettings,
  optionSettings?: ClickHouseSettings,
): ArrowStreamSettingsAttempt {
  const adapterDefaultApplied = compression === 'none'
    && !hasCompressionSetting(configSettings)
    && !hasCompressionSetting(optionSettings);

  return {
    adapterDefaultApplied,
    settings: {
      ...(adapterDefaultApplied ? { [ARROW_COMPRESSION]: 'none' } : {}),
      ...configSettings,
      ...optionSettings,
    } as ClickHouseSettings,
  };
}

/**
 * Returns guidance only when ClickHouse rejected the adapter-owned compression
 * setting; any other rejection keeps its original error.
 */
export function createReadonlyArrowCompressionError(
  error: unknown,
  adapterDefaultApplied: boolean,
): Error | undefined {
  if (!adapterDefaultApplied || !isReadonlySettingError(error, ARROW_COMPRESSION)) return undefined;

  return new Error(
    `ClickHouse rejected HypeQuery's uncompressed Arrow setting (${ARROW_COMPRESSION}='none') ` +
    `because this connection uses readonly = 1. Set ${ARROW_COMPRESSION} = 'none' in the ` +
    `user's settings profile, which readonly = 1 then accepts, or use readonly = 2. ` +
    `Otherwise set arrowCompression: 'server-default' in the HypeQuery adapter or ` +
    `query-builder configuration to omit it; batches are then compressed with the ` +
    `server's method (LZ4 by default), which JavaScript Arrow readers cannot decode.`,
    { cause: error },
  );
}
