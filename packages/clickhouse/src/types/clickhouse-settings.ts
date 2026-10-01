import type { ClickHouseSettings as NodeSettings } from '@clickhouse/client';
import type { ClickHouseSettings as LegacySettings } from '@clickhouse/client-common';
import type { ClickHouseSettings as WebSettings } from '@clickhouse/client-web';

/**
 * Settings accepted by HypeQuery from any ClickHouse JavaScript client. Their
 * SettingsMap classes have distinct private fields, so retain all three exact
 * client types rather than accepting arbitrary objects with toString().
 */
export type ClickHouseSettings = NodeSettings | WebSettings | LegacySettings;
