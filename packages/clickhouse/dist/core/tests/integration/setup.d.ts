export declare const TEST_CONNECTION_CONFIG: {
    host: string;
    user: string;
    password: string;
    database: string;
};
export declare const initializeTestConnection: () => Promise<{
    cache: import("../../cache/controller.js").CacheController;
    rawQuery<TResult = any>(sql: string, params?: unknown[]): Promise<TResult[][]>;
    table<TableName extends never>(tableName: TableName): import("../../query-builder.js").SelectQB<import("../../types/builder-state.js").SchemaDefinition<unknown>, TableName, import("../../../index.js").TableRecord<import("../../types/builder-state.js").SchemaDefinition<unknown>[TableName]>, TableName>;
}>;
export declare const ensureConnectionInitialized: () => import("@clickhouse/client").ClickHouseClient | import("@clickhouse/client-web").ClickHouseClient;
export declare const isDockerAvailable: () => Promise<boolean>;
export declare const isDockerComposeAvailable: () => Promise<boolean>;
export declare const isContainerRunning: (containerName: string) => Promise<boolean>;
export declare const isClickHouseReady: () => Promise<boolean>;
export declare const startClickHouseContainer: () => Promise<void>;
export declare const waitForClickHouse: (maxAttempts?: number, retryInterval?: number) => Promise<void>;
export declare const stopClickHouseContainer: () => Promise<void>;
export interface TestSchemaType {
    test_table: Array<{
        id: number;
        name: string;
        category: string;
        price: number;
        created_at: string;
        is_active: boolean;
    }>;
    users: Array<{
        id: number;
        user_name: string;
        email: string;
        status: string;
        created_at: string;
    }>;
    orders: Array<{
        id: number;
        user_id: number;
        product_id: number;
        quantity: number;
        total: number;
        status: string;
        created_at: string;
    }>;
}
export declare const TEST_DATA: TestSchemaType;
export declare const setupTestDatabase: () => Promise<void>;
//# sourceMappingURL=setup.d.ts.map