export interface ClickHouseGeneratorOptions {
    outputPath: string;
    includeTables?: string[];
    excludeTables?: string[];
}
export declare function generateClickHouseTypes(options: ClickHouseGeneratorOptions): Promise<void>;
//# sourceMappingURL=clickhouse.d.ts.map