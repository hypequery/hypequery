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
import { watch } from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { findQueriesFile } from '../utils/find-files.js';
import { getTableCount } from '../utils/detect-database.js';
import { loadApiModule } from '../utils/load-api.js';
import { displayQueriesFileNotFoundError } from '../utils/error-messages.js';
export function devCommand(file_1) {
    return __awaiter(this, arguments, void 0, function (file, options) {
        var queriesFile, currentServer, shouldWatch, startServer, restartServer, shutdown, watchDir, debounceTimer_1, watcher_1;
        var _this = this;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, findQueriesFile(file)];
                case 1:
                    queriesFile = _a.sent();
                    if (!queriesFile) {
                        displayQueriesFileNotFoundError('dev');
                        process.exit(1);
                    }
                    logger.info("Found: ".concat(path.relative(process.cwd(), queriesFile)));
                    logger.newline();
                    currentServer = null;
                    shouldWatch = options.watch !== false;
                    startServer = function () { return __awaiter(_this, void 0, void 0, function () {
                        var compileSpinner, dbSpinner, api, tableCount, error_1, queryCount, serveDev, address, port, hostname, baseUrl, docsPath, openapiPath, open_1, _a, error_2;
                        var _b, _c, _d, _e, _f, _g;
                        return __generator(this, function (_h) {
                            switch (_h.label) {
                                case 0:
                                    compileSpinner = ora('Compiling queries...').start();
                                    dbSpinner = ora('Connecting to ClickHouse...').start();
                                    _h.label = 1;
                                case 1:
                                    _h.trys.push([1, 14, , 15]);
                                    return [4 /*yield*/, loadApiModule(queriesFile)];
                                case 2:
                                    api = _h.sent();
                                    compileSpinner.succeed('Compiled queries');
                                    tableCount = 0;
                                    _h.label = 3;
                                case 3:
                                    _h.trys.push([3, 5, , 6]);
                                    return [4 /*yield*/, getTableCount('clickhouse')];
                                case 4:
                                    tableCount = _h.sent();
                                    dbSpinner.succeed("Connected to ClickHouse (".concat(tableCount, " tables)"));
                                    return [3 /*break*/, 6];
                                case 5:
                                    error_1 = _h.sent();
                                    // Log but don't fail - table count is optional
                                    dbSpinner.warn('Could not connect to ClickHouse');
                                    if (error_1 instanceof Error) {
                                        logger.indent("Reason: ".concat(error_1.message));
                                    }
                                    return [3 /*break*/, 6];
                                case 6:
                                    queryCount = Object.keys(api.queries || {}).length;
                                    logger.header('hypequery dev');
                                    logger.success("Registered ".concat(queryCount, " ").concat(queryCount === 1 ? 'query' : 'queries'));
                                    logger.newline();
                                    return [4 /*yield*/, import('@hypequery/serve')];
                                case 7:
                                    serveDev = (_h.sent()).serveDev;
                                    return [4 /*yield*/, serveDev(api, {
                                            port: options.port,
                                            hostname: options.hostname,
                                            quiet: true,
                                        })];
                                case 8:
                                    currentServer = _h.sent();
                                    address = currentServer.server.address();
                                    port = typeof address === 'object' && address ? address.port : options.port || 4000;
                                    hostname = options.hostname || 'localhost';
                                    baseUrl = "http://".concat(hostname, ":").concat(port);
                                    docsPath = (_c = (_b = api.docs) === null || _b === void 0 ? void 0 : _b.path) !== null && _c !== void 0 ? _c : '/docs';
                                    openapiPath = (_e = (_d = api.openapi) === null || _d === void 0 ? void 0 : _d.path) !== null && _e !== void 0 ? _e : '/openapi.json';
                                    logger.box([
                                        "Docs:     ".concat(baseUrl).concat((_f = api.basePath) !== null && _f !== void 0 ? _f : '').concat(docsPath),
                                        "OpenAPI:  ".concat(baseUrl).concat((_g = api.basePath) !== null && _g !== void 0 ? _g : '').concat(openapiPath),
                                    ]);
                                    logger.newline();
                                    logger.success("Ready in ".concat(process.uptime().toFixed(0), "ms"));
                                    logger.newline();
                                    // Query execution stats are logged automatically
                                    if (!options.quiet) {
                                        logger.info('Query execution stats will appear below as requests are made');
                                        logger.newline();
                                    }
                                    if (shouldWatch) {
                                        logger.info('Watching for changes...');
                                    }
                                    if (!options.open) return [3 /*break*/, 13];
                                    _h.label = 9;
                                case 9:
                                    _h.trys.push([9, 12, , 13]);
                                    return [4 /*yield*/, import('open')];
                                case 10:
                                    open_1 = (_h.sent()).default;
                                    return [4 /*yield*/, open_1(baseUrl)];
                                case 11:
                                    _h.sent();
                                    logger.success("Opened ".concat(baseUrl, " in browser"));
                                    return [3 /*break*/, 13];
                                case 12:
                                    _a = _h.sent();
                                    // Log but don't fail - browser open is optional
                                    logger.warn('Could not open browser automatically');
                                    logger.indent("Visit: ".concat(baseUrl));
                                    return [3 /*break*/, 13];
                                case 13: return [3 /*break*/, 15];
                                case 14:
                                    error_2 = _h.sent();
                                    // Stop spinners if they're still running
                                    if (compileSpinner.isSpinning) {
                                        compileSpinner.fail('Failed to compile queries');
                                    }
                                    if (dbSpinner.isSpinning) {
                                        dbSpinner.stop();
                                    }
                                    logger.error('Failed to start server');
                                    logger.newline();
                                    if (error_2 instanceof Error) {
                                        logger.info(error_2.message);
                                        if (error_2.stack) {
                                            logger.newline();
                                            logger.info('Stack trace:');
                                            logger.info(error_2.stack);
                                        }
                                    }
                                    else {
                                        logger.info(String(error_2));
                                    }
                                    logger.newline();
                                    if (!shouldWatch) {
                                        process.exit(1);
                                    }
                                    return [3 /*break*/, 15];
                                case 15: return [2 /*return*/];
                            }
                        });
                    }); };
                    restartServer = function () { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    if (!currentServer) return [3 /*break*/, 2];
                                    logger.newline();
                                    logger.reload('File changed, restarting...');
                                    logger.newline();
                                    return [4 /*yield*/, currentServer.stop()];
                                case 1:
                                    _a.sent();
                                    _a.label = 2;
                                case 2: return [4 /*yield*/, startServer()];
                                case 3:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); };
                    shutdown = function () { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    logger.newline();
                                    logger.info('Shutting down dev server...');
                                    if (!currentServer) return [3 /*break*/, 2];
                                    return [4 /*yield*/, currentServer.stop()];
                                case 1:
                                    _a.sent();
                                    _a.label = 2;
                                case 2:
                                    process.exit(0);
                                    return [2 /*return*/];
                            }
                        });
                    }); };
                    // Start initial server
                    return [4 /*yield*/, startServer()];
                case 2:
                    // Start initial server
                    _a.sent();
                    // Watch for changes
                    if (shouldWatch) {
                        watchDir = path.dirname(queriesFile);
                        debounceTimer_1 = null;
                        watcher_1 = watch(watchDir, { recursive: true }, function (_eventType, filename) {
                            if (!filename)
                                return;
                            // Only watch .ts and .js files
                            if (!filename.endsWith('.ts') && !filename.endsWith('.js')) {
                                return;
                            }
                            // Debounce file changes
                            if (debounceTimer_1) {
                                clearTimeout(debounceTimer_1);
                            }
                            debounceTimer_1 = setTimeout(function () { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, restartServer()];
                                        case 1:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); }, 100);
                        });
                        process.once('SIGINT', function () {
                            watcher_1.close();
                            shutdown();
                        });
                        process.once('SIGTERM', function () {
                            watcher_1.close();
                            shutdown();
                        });
                    }
                    else {
                        process.once('SIGINT', shutdown);
                        process.once('SIGTERM', shutdown);
                    }
                    return [2 /*return*/];
            }
        });
    });
}
