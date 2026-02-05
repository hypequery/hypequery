/**
 * Database type detection result
 */
export type DatabaseType = 'clickhouse' | 'bigquery' | 'unknown';
/**
 * Auto-detect database type from environment or config files
 */
export declare function detectDatabase(): Promise<DatabaseType>;
/**
 * Validate database connection
 */
export declare function validateConnection(dbType: DatabaseType): Promise<boolean>;
/**
 * Get table count from database
 */
export declare function getTableCount(dbType: DatabaseType): Promise<number>;
/**
 * Get list of tables from database
 */
export declare function getTables(dbType: DatabaseType): Promise<string[]>;
//# sourceMappingURL=detect-database.d.ts.map