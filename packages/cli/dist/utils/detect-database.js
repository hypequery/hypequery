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
import { access } from 'node:fs/promises';
import path from 'node:path';
import { getClickHouseClient } from './clickhouse-client.js';
/**
 * Auto-detect database type from environment or config files
 */
export function detectDatabase() {
    return __awaiter(this, void 0, void 0, function () {
        var envPath, readFile, envContent, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    // Check environment variables
                    if (process.env.CLICKHOUSE_HOST ||
                        process.env.CLICKHOUSE_URL ||
                        process.env.CLICKHOUSE_DATABASE) {
                        return [2 /*return*/, 'clickhouse'];
                    }
                    if (process.env.BIGQUERY_PROJECT_ID || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                        return [2 /*return*/, 'bigquery'];
                    }
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 5, , 6]);
                    envPath = path.join(process.cwd(), '.env');
                    return [4 /*yield*/, access(envPath)];
                case 2:
                    _b.sent();
                    return [4 /*yield*/, import('node:fs/promises')];
                case 3:
                    readFile = (_b.sent()).readFile;
                    return [4 /*yield*/, readFile(envPath, 'utf-8')];
                case 4:
                    envContent = _b.sent();
                    if (envContent.includes('CLICKHOUSE_') ||
                        envContent.includes('CLICKHOUSE_HOST')) {
                        return [2 /*return*/, 'clickhouse'];
                    }
                    if (envContent.includes('BIGQUERY_') ||
                        envContent.includes('GOOGLE_APPLICATION_CREDENTIALS')) {
                        return [2 /*return*/, 'bigquery'];
                    }
                    return [3 /*break*/, 6];
                case 5:
                    _a = _b.sent();
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/, 'unknown'];
            }
        });
    });
}
/**
 * Validate database connection
 */
export function validateConnection(dbType) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (dbType) {
                case 'clickhouse':
                    return [2 /*return*/, validateClickHouse()];
                case 'bigquery':
                    return [2 /*return*/, validateBigQuery()];
                default:
                    return [2 /*return*/, false];
            }
            return [2 /*return*/];
        });
    });
}
function validateClickHouse() {
    return __awaiter(this, void 0, void 0, function () {
        var client, result, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 3, , 4]);
                    client = getClickHouseClient();
                    return [4 /*yield*/, client.query({
                            query: 'SELECT 1',
                            format: 'JSONEachRow',
                        })];
                case 1:
                    result = _b.sent();
                    return [4 /*yield*/, result.json()];
                case 2:
                    _b.sent();
                    return [2 /*return*/, true];
                case 3:
                    _a = _b.sent();
                    return [2 /*return*/, false];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function validateBigQuery() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            // TODO: Implement when BigQuery support is added
            return [2 /*return*/, false];
        });
    });
}
/**
 * Get table count from database
 */
export function getTableCount(dbType) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (dbType) {
                case 'clickhouse':
                    return [2 /*return*/, getClickHouseTableCount()];
                default:
                    return [2 /*return*/, 0];
            }
            return [2 /*return*/];
        });
    });
}
/**
 * Generic helper to execute ClickHouse queries with consistent error handling
 */
function executeClickHouseQuery(query, defaultValue) {
    return __awaiter(this, void 0, void 0, function () {
        var client, result, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 3, , 4]);
                    client = getClickHouseClient();
                    return [4 /*yield*/, client.query({
                            query: query,
                            format: 'JSONEachRow',
                        })];
                case 1:
                    result = _b.sent();
                    return [4 /*yield*/, result.json()];
                case 2: return [2 /*return*/, (_b.sent())];
                case 3:
                    _a = _b.sent();
                    return [2 /*return*/, defaultValue];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function getClickHouseTableCount() {
    return __awaiter(this, void 0, void 0, function () {
        var tables;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, executeClickHouseQuery('SHOW TABLES', [])];
                case 1:
                    tables = _a.sent();
                    return [2 /*return*/, Array.isArray(tables) ? tables.length : 0];
            }
        });
    });
}
/**
 * Get list of tables from database
 */
export function getTables(dbType) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (dbType) {
                case 'clickhouse':
                    return [2 /*return*/, getClickHouseTables()];
                default:
                    return [2 /*return*/, []];
            }
            return [2 /*return*/];
        });
    });
}
function getClickHouseTables() {
    return __awaiter(this, void 0, void 0, function () {
        var tables;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, executeClickHouseQuery('SHOW TABLES', [])];
                case 1:
                    tables = _a.sent();
                    return [2 /*return*/, tables.map(function (t) { return t.name; })];
            }
        });
    });
}
