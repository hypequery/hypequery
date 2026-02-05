import type { Mock } from 'vitest';
/**
 * Mock prompts module for testing
 */
export declare function createMockPrompts(): {
    promptDatabaseType: Mock<(...args: any[]) => any>;
    promptClickHouseConnection: Mock<(...args: any[]) => any>;
    promptOutputDirectory: Mock<(...args: any[]) => any>;
    promptGenerateExample: Mock<(...args: any[]) => any>;
    promptTableSelection: Mock<(...args: any[]) => any>;
    confirmOverwrite: Mock<(...args: any[]) => any>;
    promptRetry: Mock<(...args: any[]) => any>;
    promptContinueWithoutDb: Mock<(...args: any[]) => any>;
};
/**
 * Mock database detection utilities
 */
export declare function createMockDatabaseUtils(): {
    validateConnection: Mock<(...args: any[]) => any>;
    getTableCount: Mock<(...args: any[]) => any>;
    getTables: Mock<(...args: any[]) => any>;
};
/**
 * Mock file system utilities
 */
export declare function createMockFileUtils(): {
    hasEnvFile: Mock<(...args: any[]) => any>;
    hasGitignore: Mock<(...args: any[]) => any>;
    findQueriesFile: Mock<(...args: any[]) => any>;
    findSchemaFile: Mock<(...args: any[]) => any>;
};
/**
 * Mock logger to capture output
 */
export declare function createMockLogger(): {
    success: Mock<(...args: any[]) => any>;
    error: Mock<(...args: any[]) => any>;
    warn: Mock<(...args: any[]) => any>;
    info: Mock<(...args: any[]) => any>;
    reload: Mock<(...args: any[]) => any>;
    header: Mock<(...args: any[]) => any>;
    newline: Mock<(...args: any[]) => any>;
    indent: Mock<(...args: any[]) => any>;
    box: Mock<(...args: any[]) => any>;
    table: Mock<(...args: any[]) => any>;
    raw: Mock<(...args: any[]) => any>;
};
/**
 * Mock ora spinner
 */
export declare function createMockSpinner(): Mock<() => {
    start: Mock<(...args: any[]) => any>;
    succeed: Mock<(...args: any[]) => any>;
    fail: Mock<(...args: any[]) => any>;
    stop: Mock<(...args: any[]) => any>;
}>;
/**
 * Mock fs/promises for file operations
 */
export declare function createMockFs(): {
    mkdir: Mock<(...args: any[]) => any>;
    writeFile: Mock<(...args: any[]) => any>;
    readFile: Mock<(...args: any[]) => any>;
    access: Mock<(...args: any[]) => any>;
};
/**
 * Capture console output
 */
export declare function captureConsole(): {
    logs: string[];
    errors: string[];
    restore: () => void;
};
/**
 * Mock process.exit to prevent tests from exiting
 * Throws a special error to stop execution
 */
export declare class ProcessExitError extends Error {
    code: number;
    constructor(code: number);
}
export declare function mockProcessExit(): {
    exitMock: Mock<(...args: any[]) => any>;
    restore: () => void;
};
//# sourceMappingURL=test-utils.d.ts.map