var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
import { vi } from 'vitest';
/**
 * Mock prompts module for testing
 */
export function createMockPrompts() {
    return {
        promptDatabaseType: vi.fn(),
        promptClickHouseConnection: vi.fn(),
        promptOutputDirectory: vi.fn(),
        promptGenerateExample: vi.fn(),
        promptTableSelection: vi.fn(),
        confirmOverwrite: vi.fn(),
        promptRetry: vi.fn(),
        promptContinueWithoutDb: vi.fn(),
    };
}
/**
 * Mock database detection utilities
 */
export function createMockDatabaseUtils() {
    return {
        validateConnection: vi.fn(),
        getTableCount: vi.fn(),
        getTables: vi.fn(),
    };
}
/**
 * Mock file system utilities
 */
export function createMockFileUtils() {
    return {
        hasEnvFile: vi.fn(),
        hasGitignore: vi.fn(),
        findQueriesFile: vi.fn(),
        findSchemaFile: vi.fn(),
    };
}
/**
 * Mock logger to capture output
 */
export function createMockLogger() {
    return {
        success: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        reload: vi.fn(),
        header: vi.fn(),
        newline: vi.fn(),
        indent: vi.fn(),
        box: vi.fn(),
        table: vi.fn(),
        raw: vi.fn(),
    };
}
/**
 * Mock ora spinner
 */
export function createMockSpinner() {
    var spinner = {
        start: vi.fn().mockReturnThis(),
        succeed: vi.fn().mockReturnThis(),
        fail: vi.fn().mockReturnThis(),
        stop: vi.fn().mockReturnThis(),
    };
    return vi.fn(function () { return spinner; });
}
/**
 * Mock fs/promises for file operations
 */
export function createMockFs() {
    return {
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(''),
        access: vi.fn().mockResolvedValue(undefined),
    };
}
/**
 * Capture console output
 */
export function captureConsole() {
    var logs = [];
    var errors = [];
    var originalLog = console.log;
    var originalError = console.error;
    console.log = vi.fn(function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        logs.push(args.join(' '));
    });
    console.error = vi.fn(function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        errors.push(args.join(' '));
    });
    return {
        logs: logs,
        errors: errors,
        restore: function () {
            console.log = originalLog;
            console.error = originalError;
        },
    };
}
/**
 * Mock process.exit to prevent tests from exiting
 * Throws a special error to stop execution
 */
var ProcessExitError = /** @class */ (function (_super) {
    __extends(ProcessExitError, _super);
    function ProcessExitError(code) {
        var _this = _super.call(this, "process.exit called with code ".concat(code)) || this;
        _this.code = code;
        _this.name = 'ProcessExitError';
        return _this;
    }
    return ProcessExitError;
}(Error));
export { ProcessExitError };
export function mockProcessExit() {
    var originalExit = process.exit;
    var exitMock = vi.fn(function (code) {
        throw new ProcessExitError(code !== null && code !== void 0 ? code : 0);
    });
    // @ts-ignore
    process.exit = exitMock;
    return {
        exitMock: exitMock,
        restore: function () {
            process.exit = originalExit;
        },
    };
}
