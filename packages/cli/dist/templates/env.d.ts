/**
 * Generate .env file content for ClickHouse
 */
export declare function generateEnvTemplate(config: {
    host: string;
    database: string;
    username: string;
    password: string;
}): string;
/**
 * Append to existing .env file
 */
export declare function appendToEnv(existingContent: string, newContent: string): string;
//# sourceMappingURL=env.d.ts.map