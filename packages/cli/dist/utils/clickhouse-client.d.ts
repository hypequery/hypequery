import { type ClickHouseClient } from '@clickhouse/client';
export interface ClickHouseEnvConfig {
    url: string;
    username: string;
    password: string;
    database: string;
}
export declare function getClickHouseConfigFromEnv(): ClickHouseEnvConfig | null;
export declare function getClickHouseClient(): ClickHouseClient;
export declare function resetClickHouseClientForTesting(): Promise<void>;
//# sourceMappingURL=clickhouse-client.d.ts.map