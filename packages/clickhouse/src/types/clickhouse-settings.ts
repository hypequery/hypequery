import type { ClickHouseSettings as NodeSettings } from '@clickhouse/client';

/**
 * SettingsMap instances from the Node, web, and legacy common clients all
 * serialize to the same ClickHouse setting value, but their private fields make
 * the package types incompatible in TypeScript.
 */
interface SettingsMapLike {
  toString(): string;
}

/** Settings accepted by HypeQuery from any ClickHouse JavaScript client. */
export type ClickHouseSettings =
  | NodeSettings
  | Record<string, string | number | boolean | SettingsMapLike | undefined>;
