/**
 * Find the queries file in the project
 */
export declare function findQueriesFile(customPath?: string): Promise<string | null>;
/**
 * Find the schema file (generated types)
 */
export declare function findSchemaFile(): Promise<string | null>;
/**
 * Find the client file
 */
export declare function findClientFile(): Promise<string | null>;
/**
 * Check if .env file exists
 */
export declare function hasEnvFile(): Promise<boolean>;
/**
 * Check if .gitignore exists
 */
export declare function hasGitignore(): Promise<boolean>;
//# sourceMappingURL=find-files.d.ts.map