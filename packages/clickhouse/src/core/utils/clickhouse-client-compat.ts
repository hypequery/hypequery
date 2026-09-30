import type { BaseClickHouseClientConfigOptions, ClickHouseSettings } from '@clickhouse/client-common';
import type {
  ClickHouseClientConfigOptions as NodeClientConfig,
  ClickHouseSettings as NodeSettings,
} from '@clickhouse/client';
import type { ClickHouseSettings as WebSettings } from '@clickhouse/client-web';

/**
 * The clients now bundle their own common types. Their SettingsMap classes are
 * nominally distinct from the deprecated client-common package, although they
 * have the same runtime shape and serialization method.
 */
export function toClientSettings(settings: ClickHouseSettings): NodeSettings & WebSettings {
  return settings as unknown as NodeSettings & WebSettings;
}

export function toNodeClientConfig(config: BaseClickHouseClientConfigOptions): NodeClientConfig {
  return config as unknown as NodeClientConfig;
}
