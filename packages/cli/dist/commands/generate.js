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
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { findSchemaFile } from '../utils/find-files.js';
import { detectDatabase, getTableCount } from '../utils/detect-database.js';
import { getTypeGenerator } from '../generators/index.js';
export function generateCommand() {
    return __awaiter(this, arguments, void 0, function (options) {
        var outputPath, existingSchema, parsedTables, requestedDbType, dbType, _a, spinner, generator, tableCount, typeSpinner, error_1;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!options.output) return [3 /*break*/, 1];
                    outputPath = path.resolve(process.cwd(), options.output);
                    return [3 /*break*/, 3];
                case 1: return [4 /*yield*/, findSchemaFile()];
                case 2:
                    existingSchema = _b.sent();
                    if (existingSchema) {
                        outputPath = existingSchema;
                    }
                    else {
                        // Default to analytics/schema.ts
                        outputPath = path.join(process.cwd(), 'analytics', 'schema.ts');
                    }
                    _b.label = 3;
                case 3:
                    parsedTables = options.tables
                        ? options.tables
                            .split(',')
                            .map(function (table) { return table.trim(); })
                            .filter(Boolean)
                        : undefined;
                    requestedDbType = options.database;
                    if (!(requestedDbType !== null && requestedDbType !== void 0)) return [3 /*break*/, 4];
                    _a = requestedDbType;
                    return [3 /*break*/, 6];
                case 4: return [4 /*yield*/, detectDatabase()];
                case 5:
                    _a = (_b.sent());
                    _b.label = 6;
                case 6:
                    dbType = _a;
                    logger.newline();
                    logger.header('hypequery generate');
                    spinner = ora("Connecting to ".concat(dbType, "...")).start();
                    _b.label = 7;
                case 7:
                    _b.trys.push([7, 10, , 11]);
                    generator = getTypeGenerator(dbType);
                    return [4 /*yield*/, getTableCount(dbType)];
                case 8:
                    tableCount = _b.sent();
                    spinner.succeed("Connected to ".concat(dbType === 'clickhouse' ? 'ClickHouse' : dbType));
                    logger.success("Found ".concat(tableCount, " tables"));
                    typeSpinner = ora('Generating types...').start();
                    return [4 /*yield*/, generator({
                            outputPath: outputPath,
                            includeTables: parsedTables,
                        })];
                case 9:
                    _b.sent();
                    typeSpinner.succeed("Generated types for ".concat(tableCount, " tables"));
                    logger.success("Updated ".concat(path.relative(process.cwd(), outputPath)));
                    logger.newline();
                    logger.header('Types regenerated successfully!');
                    logger.newline();
                    return [3 /*break*/, 11];
                case 10:
                    error_1 = _b.sent();
                    spinner.fail('Failed to generate types');
                    logger.newline();
                    if (error_1 instanceof Error) {
                        logger.error(error_1.message);
                        // Provide specific guidance based on error type
                        if (error_1.message.includes('ECONNREFUSED')) {
                            logger.newline();
                            logger.info('This usually means:');
                            logger.indent('• ClickHouse is not running');
                            logger.indent('• Wrong host/port in configuration');
                            logger.indent('• Firewall blocking connection');
                            logger.newline();
                            logger.info('Check your configuration:');
                            logger.indent('CLICKHOUSE_HOST=' + (process.env.CLICKHOUSE_HOST || 'not set'));
                            logger.newline();
                            logger.info('Docs: https://hypequery.com/docs/troubleshooting#connection-errors');
                        }
                        else if (error_1.message.includes('ETIMEDOUT') || error_1.message.includes('timeout')) {
                            logger.newline();
                            logger.info('Database connection timed out');
                            logger.newline();
                            logger.info('This usually means:');
                            logger.indent('• Database is running but not responding');
                            logger.indent('• Network latency is too high');
                            logger.indent('• Firewall is dropping packets');
                            logger.newline();
                            logger.info('Try:');
                            logger.indent('• Check if database is under heavy load');
                            logger.indent('• Verify network connectivity');
                            logger.indent('• Check firewall rules');
                        }
                        else if (error_1.message.toLowerCase().includes('ssl') || error_1.message.toLowerCase().includes('tls')) {
                            logger.newline();
                            logger.info('SSL/TLS connection error');
                            logger.newline();
                            logger.info('This usually means:');
                            logger.indent('• SSL certificate validation failed');
                            logger.indent('• Incorrect SSL configuration');
                            logger.newline();
                            logger.info('Try:');
                            logger.indent('• Check if your connection string requires SSL');
                            logger.indent('• Verify SSL certificate is valid');
                            logger.indent('• Check SSL-related environment variables');
                        }
                        else if (error_1.message.toLowerCase().includes('authentication') || error_1.message.toLowerCase().includes('auth')) {
                            logger.newline();
                            logger.info('Authentication failed');
                            logger.newline();
                            logger.info('This usually means:');
                            logger.indent('• Invalid username or password');
                            logger.indent('• User does not have required permissions');
                            logger.newline();
                            logger.info('Check your configuration:');
                            logger.indent('CLICKHOUSE_USERNAME=' + (process.env.CLICKHOUSE_USERNAME || 'not set'));
                            logger.indent('CLICKHOUSE_PASSWORD=' + (process.env.CLICKHOUSE_PASSWORD ? '***' : 'not set'));
                        }
                    }
                    else {
                        logger.error(String(error_1));
                    }
                    logger.newline();
                    process.exit(1);
                    return [3 /*break*/, 11];
                case 11: return [2 /*return*/];
            }
        });
    });
}
