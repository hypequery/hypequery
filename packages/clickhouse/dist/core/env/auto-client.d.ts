import type { ClickHouseSettings } from '@clickhouse/client-common';
type NodeClientModule = typeof import('@clickhouse/client');
export interface AutoClientModule {
    createClient: NodeClientModule['createClient'];
    ClickHouseSettings?: ClickHouseSettings;
}
export declare function getAutoClientModule(): AutoClientModule;
export {};
//# sourceMappingURL=auto-client.d.ts.map