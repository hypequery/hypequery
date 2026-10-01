import type { ClickHouseSettings as LegacySettings } from '@clickhouse/client-common';
import type { ClickHouseSettings as NodeSettings } from '@clickhouse/client';
import type { ClickHouseSettings as WebSettings } from '@clickhouse/client-web';
import type { Equal, Expect } from '@type-challenges/utils';
import type {
  ClickHouseConfig,
  ClickHouseSettings,
  QueryExecutionOptions,
} from '../src/index.js';

type AcceptsLegacySettings = Expect<Equal<LegacySettings extends ClickHouseSettings ? true : false, true>>;
type AcceptsNodeSettings = Expect<Equal<NodeSettings extends ClickHouseSettings ? true : false, true>>;
type AcceptsWebSettings = Expect<Equal<WebSettings extends ClickHouseSettings ? true : false, true>>;

type ConnectionSettings = NonNullable<ClickHouseConfig['clickhouse_settings']>;
type AcceptsLegacyConnectionSettings = Expect<Equal<LegacySettings extends ConnectionSettings ? true : false, true>>;
type AcceptsLegacyQuerySettings = Expect<Equal<LegacySettings extends NonNullable<QueryExecutionOptions['clickhouseSettings']> ? true : false, true>>;

export type SettingsCompatibility = [
  AcceptsLegacySettings,
  AcceptsNodeSettings,
  AcceptsWebSettings,
  AcceptsLegacyConnectionSettings,
  AcceptsLegacyQuerySettings,
];
