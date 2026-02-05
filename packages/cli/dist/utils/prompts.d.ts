import type { DatabaseType } from './detect-database.js';
/**
 * Prompt for database type selection
 */
export declare function promptDatabaseType(): Promise<DatabaseType | null>;
/**
 * Prompt for ClickHouse connection details
 */
export declare function promptClickHouseConnection(): Promise<{
    host: string;
    database: string;
    username: string;
    password: string;
} | null>;
/**
 * Prompt for output directory
 */
export declare function promptOutputDirectory(): Promise<string>;
/**
 * Prompt for example query generation
 */
export declare function promptGenerateExample(): Promise<boolean>;
/**
 * Prompt for table selection (for example query)
 */
export declare function promptTableSelection(tables: string[]): Promise<string | null>;
/**
 * Confirm overwrite of existing files
 */
export declare function confirmOverwrite(files: string[]): Promise<boolean>;
/**
 * Retry prompt for failed operations
 */
export declare function promptRetry(message: string): Promise<boolean>;
/**
 * Ask if user wants to continue without DB connection
 */
export declare function promptContinueWithoutDb(): Promise<boolean>;
//# sourceMappingURL=prompts.d.ts.map