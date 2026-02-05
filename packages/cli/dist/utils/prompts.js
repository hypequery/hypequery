var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import prompts from 'prompts';
import { logger } from './logger.js';
// Configure prompts to not exit on cancel
prompts.override({ onCancel: function () { } });
/**
 * Prompt for database type selection
 */
export function promptDatabaseType() {
    return __awaiter(this, void 0, void 0, function () {
        var response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, prompts({
                        type: 'select',
                        name: 'database',
                        message: 'Which database are you using?',
                        choices: [
                            { title: 'ClickHouse', value: 'clickhouse' },
                            { title: 'BigQuery (coming soon)', value: 'bigquery', disabled: true },
                        ],
                        initial: 0,
                    })];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response.database || null];
            }
        });
    });
}
/**
 * Prompt for ClickHouse connection details
 */
export function promptClickHouseConnection() {
    return __awaiter(this, void 0, void 0, function () {
        var response;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0: return [4 /*yield*/, prompts([
                        {
                            type: 'text',
                            name: 'host',
                            message: 'ClickHouse host (or skip to configure later):',
                            initial: (_a = process.env.CLICKHOUSE_HOST) !== null && _a !== void 0 ? _a : '',
                        },
                        {
                            type: 'text',
                            name: 'database',
                            message: 'Database:',
                            initial: (_b = process.env.CLICKHOUSE_DATABASE) !== null && _b !== void 0 ? _b : '',
                        },
                        {
                            type: 'text',
                            name: 'username',
                            message: 'Username:',
                            initial: (_c = process.env.CLICKHOUSE_USERNAME) !== null && _c !== void 0 ? _c : '',
                        },
                        {
                            type: 'password',
                            name: 'password',
                            message: 'Password:',
                            initial: (_d = process.env.CLICKHOUSE_PASSWORD) !== null && _d !== void 0 ? _d : '',
                        },
                    ])];
                case 1:
                    response = _e.sent();
                    // If user cancelled or skipped
                    if (!response.host) {
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, response];
            }
        });
    });
}
/**
 * Prompt for output directory
 */
export function promptOutputDirectory() {
    return __awaiter(this, void 0, void 0, function () {
        var response, customResponse;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, prompts({
                        type: 'select',
                        name: 'directory',
                        message: 'Where should we create your analytics files?',
                        choices: [
                            { title: 'analytics/ (recommended)', value: 'analytics' },
                            { title: 'src/analytics/', value: 'src/analytics' },
                            { title: 'Custom path...', value: 'custom' },
                        ],
                        initial: 0,
                    })];
                case 1:
                    response = _a.sent();
                    if (!response.directory) {
                        return [2 /*return*/, 'analytics']; // Default fallback
                    }
                    if (!(response.directory === 'custom')) return [3 /*break*/, 3];
                    return [4 /*yield*/, prompts({
                            type: 'text',
                            name: 'path',
                            message: 'Enter custom path:',
                            initial: 'analytics',
                        })];
                case 2:
                    customResponse = _a.sent();
                    return [2 /*return*/, customResponse.path || 'analytics'];
                case 3: return [2 /*return*/, response.directory];
            }
        });
    });
}
/**
 * Prompt for example query generation
 */
export function promptGenerateExample() {
    return __awaiter(this, void 0, void 0, function () {
        var response;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, prompts({
                        type: 'confirm',
                        name: 'generate',
                        message: 'Generate an example query?',
                        initial: true,
                    })];
                case 1:
                    response = _b.sent();
                    return [2 /*return*/, (_a = response.generate) !== null && _a !== void 0 ? _a : false];
            }
        });
    });
}
/**
 * Prompt for table selection (for example query)
 */
export function promptTableSelection(tables) {
    return __awaiter(this, void 0, void 0, function () {
        var choices, response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (tables.length === 0) {
                        return [2 /*return*/, null];
                    }
                    // Warn if showing truncated list
                    if (tables.length > 10) {
                        logger.warn("Showing first 10 of ".concat(tables.length, " tables"));
                        logger.indent('You can select a different table by editing the generated file');
                        logger.newline();
                    }
                    choices = __spreadArray(__spreadArray([], tables.slice(0, 10).map(function (table) { return ({ title: table, value: table }); }), true), [
                        { title: 'Skip example', value: null },
                    ], false);
                    return [4 /*yield*/, prompts({
                            type: 'select',
                            name: 'table',
                            message: 'Which table should we use for the example?',
                            choices: choices,
                            initial: 0,
                        })];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response.table];
            }
        });
    });
}
/**
 * Confirm overwrite of existing files
 */
export function confirmOverwrite(files) {
    return __awaiter(this, void 0, void 0, function () {
        var response;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, prompts({
                        type: 'confirm',
                        name: 'overwrite',
                        message: "The following files will be overwritten:\n".concat(files.map(function (f) { return "  \u2022 ".concat(f); }).join('\n'), "\n\nContinue?"),
                        initial: false,
                    })];
                case 1:
                    response = _b.sent();
                    return [2 /*return*/, (_a = response.overwrite) !== null && _a !== void 0 ? _a : false];
            }
        });
    });
}
/**
 * Retry prompt for failed operations
 */
export function promptRetry(message) {
    return __awaiter(this, void 0, void 0, function () {
        var response;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, prompts({
                        type: 'confirm',
                        name: 'retry',
                        message: message,
                        initial: true,
                    })];
                case 1:
                    response = _b.sent();
                    return [2 /*return*/, (_a = response.retry) !== null && _a !== void 0 ? _a : false];
            }
        });
    });
}
/**
 * Ask if user wants to continue without DB connection
 */
export function promptContinueWithoutDb() {
    return __awaiter(this, void 0, void 0, function () {
        var response;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, prompts({
                        type: 'confirm',
                        name: 'continue',
                        message: 'Continue setup without database connection?',
                        initial: true,
                    })];
                case 1:
                    response = _b.sent();
                    return [2 /*return*/, (_a = response.continue) !== null && _a !== void 0 ? _a : false];
            }
        });
    });
}
