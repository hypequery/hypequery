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
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { promptDatabaseType, promptClickHouseConnection, promptOutputDirectory, promptGenerateExample, promptTableSelection, confirmOverwrite, promptRetry, promptContinueWithoutDb, } from '../utils/prompts.js';
import { validateConnection, getTableCount, getTables, } from '../utils/detect-database.js';
import { hasEnvFile, hasGitignore } from '../utils/find-files.js';
import { generateEnvTemplate, appendToEnv } from '../templates/env.js';
import { generateClientTemplate } from '../templates/client.js';
import { generateQueriesTemplate } from '../templates/queries.js';
import { appendToGitignore } from '../templates/gitignore.js';
import { getTypeGenerator } from '../generators/index.js';
import { installServeDependencies } from '../utils/dependency-installer.js';
function determineDatabase(options) {
    return __awaiter(this, void 0, void 0, function () {
        var dbType, _a;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!((_b = options.database) !== null && _b !== void 0)) return [3 /*break*/, 1];
                    _a = _b;
                    return [3 /*break*/, 3];
                case 1: return [4 /*yield*/, promptDatabaseType()];
                case 2:
                    _a = (_c.sent());
                    _c.label = 3;
                case 3:
                    dbType = _a;
                    if (!dbType) {
                        logger.info('Setup cancelled');
                        process.exit(0);
                    }
                    if (dbType !== 'clickhouse') {
                        logger.error("".concat(dbType, " is not yet supported. Only ClickHouse is available."));
                        process.exit(1);
                    }
                    return [2 /*return*/, dbType];
            }
        });
    });
}
function resolveConnectionConfig(options) {
    return __awaiter(this, void 0, void 0, function () {
        var required;
        var _a;
        return __generator(this, function (_b) {
            if (options.noInteractive) {
                required = function (key) {
                    var value = process.env[key];
                    if (!value) {
                        throw new Error("Missing ".concat(key, ". Provide ClickHouse connection info via environment variables when using --no-interactive."));
                    }
                    return value;
                };
                return [2 /*return*/, {
                        host: required('CLICKHOUSE_HOST'),
                        database: required('CLICKHOUSE_DATABASE'),
                        username: required('CLICKHOUSE_USERNAME'),
                        password: (_a = process.env.CLICKHOUSE_PASSWORD) !== null && _a !== void 0 ? _a : '',
                    }];
            }
            return [2 /*return*/, promptClickHouseConnection()];
        });
    });
}
function testConnection(connectionConfig, dbType) {
    return __awaiter(this, void 0, void 0, function () {
        var spinner, isValid, tableCount;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    spinner = ora('Testing connection...').start();
                    process.env.CLICKHOUSE_HOST = connectionConfig.host;
                    process.env.CLICKHOUSE_DATABASE = connectionConfig.database;
                    process.env.CLICKHOUSE_USERNAME = connectionConfig.username;
                    process.env.CLICKHOUSE_PASSWORD = connectionConfig.password;
                    return [4 /*yield*/, validateConnection(dbType)];
                case 1:
                    isValid = _a.sent();
                    if (!isValid) {
                        spinner.fail('Connection failed');
                        logger.newline();
                        logger.error("Could not connect to ClickHouse at ".concat(connectionConfig.host));
                        logger.newline();
                        logger.info('Common issues:');
                        logger.indent('• Check your host URL includes http:// or https://');
                        logger.indent('• Verify username and password');
                        logger.indent('• Ensure database exists');
                        logger.indent('• Check firewall/network access');
                        logger.newline();
                        return [2 /*return*/, { hasValidConnection: false, tableCount: 0 }];
                    }
                    return [4 /*yield*/, getTableCount(dbType)];
                case 2:
                    tableCount = _a.sent();
                    spinner.succeed("Connected successfully (".concat(tableCount, " tables found)"));
                    logger.newline();
                    return [2 /*return*/, { hasValidConnection: true, tableCount: tableCount }];
            }
        });
    });
}
export function initCommand() {
    return __awaiter(this, arguments, void 0, function (options) {
        var dbType, connectionConfig, hasValidConnection, tableCount, _a, valid, count, retry, continueWithout, outputDir, resolvedOutputDir, filesToCreate, existingFiles, _i, filesToCreate_1, file, _b, shouldOverwrite, generateExample, selectedTable, tables, envPath, envExists, existingEnv, newEnv, envPath, envExists, placeholderConfig, schemaPath, typeSpinner, generator, error_1, clientPath, queriesPath, gitignorePath, gitignoreExists, existingGitignore, newGitignore, exampleQueryKey;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    logger.newline();
                    logger.header('Welcome to hypequery!');
                    logger.info("Let's set up your analytics layer.");
                    logger.newline();
                    return [4 /*yield*/, determineDatabase(options)];
                case 1:
                    dbType = _c.sent();
                    return [4 /*yield*/, resolveConnectionConfig(options)];
                case 2:
                    connectionConfig = _c.sent();
                    hasValidConnection = false;
                    tableCount = 0;
                    if (!!connectionConfig) return [3 /*break*/, 3];
                    logger.info('Skipping database connection for now.');
                    logger.newline();
                    return [3 /*break*/, 8];
                case 3:
                    if (!options.skipConnection) return [3 /*break*/, 4];
                    logger.info('Skipping database connection test (requested).');
                    logger.newline();
                    return [3 /*break*/, 8];
                case 4: return [4 /*yield*/, testConnection(connectionConfig, dbType)];
                case 5:
                    _a = _c.sent(), valid = _a.hasValidConnection, count = _a.tableCount;
                    hasValidConnection = valid;
                    tableCount = count;
                    if (!!hasValidConnection) return [3 /*break*/, 8];
                    return [4 /*yield*/, promptRetry('Try again?')];
                case 6:
                    retry = _c.sent();
                    if (retry) {
                        return [2 /*return*/, initCommand(options)];
                    }
                    return [4 /*yield*/, promptContinueWithoutDb()];
                case 7:
                    continueWithout = _c.sent();
                    if (!continueWithout) {
                        logger.info('Setup cancelled');
                        process.exit(0);
                    }
                    logger.newline();
                    logger.info('Continuing without database connection.');
                    logger.info('You can configure the connection later in .env');
                    logger.newline();
                    connectionConfig = null;
                    _c.label = 8;
                case 8:
                    outputDir = options.path;
                    if (!(!outputDir && !options.noInteractive)) return [3 /*break*/, 10];
                    return [4 /*yield*/, promptOutputDirectory()];
                case 9:
                    outputDir = _c.sent();
                    return [3 /*break*/, 11];
                case 10:
                    if (!outputDir) {
                        outputDir = 'analytics';
                    }
                    _c.label = 11;
                case 11:
                    resolvedOutputDir = path.resolve(process.cwd(), outputDir);
                    filesToCreate = [
                        path.join(resolvedOutputDir, 'client.ts'),
                        path.join(resolvedOutputDir, 'schema.ts'),
                        path.join(resolvedOutputDir, 'queries.ts'),
                    ];
                    existingFiles = [];
                    _i = 0, filesToCreate_1 = filesToCreate;
                    _c.label = 12;
                case 12:
                    if (!(_i < filesToCreate_1.length)) return [3 /*break*/, 17];
                    file = filesToCreate_1[_i];
                    _c.label = 13;
                case 13:
                    _c.trys.push([13, 15, , 16]);
                    return [4 /*yield*/, access(file)];
                case 14:
                    _c.sent();
                    existingFiles.push(path.relative(process.cwd(), file));
                    return [3 /*break*/, 16];
                case 15:
                    _b = _c.sent();
                    return [3 /*break*/, 16];
                case 16:
                    _i++;
                    return [3 /*break*/, 12];
                case 17:
                    if (!(existingFiles.length > 0 && !options.force)) return [3 /*break*/, 19];
                    logger.warn('Files already exist');
                    logger.newline();
                    return [4 /*yield*/, confirmOverwrite(existingFiles)];
                case 18:
                    shouldOverwrite = _c.sent();
                    if (!shouldOverwrite) {
                        logger.info('Setup cancelled');
                        process.exit(0);
                    }
                    logger.newline();
                    _c.label = 19;
                case 19:
                    generateExample = !options.noExample && hasValidConnection;
                    selectedTable = null;
                    if (!(generateExample && !options.noInteractive && hasValidConnection)) return [3 /*break*/, 23];
                    return [4 /*yield*/, promptGenerateExample()];
                case 20:
                    generateExample = _c.sent();
                    if (!generateExample) return [3 /*break*/, 23];
                    return [4 /*yield*/, getTables(dbType)];
                case 21:
                    tables = _c.sent();
                    return [4 /*yield*/, promptTableSelection(tables)];
                case 22:
                    selectedTable = _c.sent();
                    generateExample = selectedTable !== null;
                    _c.label = 23;
                case 23:
                    logger.newline();
                    // Step 7: Create directory
                    return [4 /*yield*/, mkdir(resolvedOutputDir, { recursive: true })];
                case 24:
                    // Step 7: Create directory
                    _c.sent();
                    if (!connectionConfig) return [3 /*break*/, 31];
                    envPath = path.join(process.cwd(), '.env');
                    return [4 /*yield*/, hasEnvFile()];
                case 25:
                    envExists = _c.sent();
                    if (!envExists) return [3 /*break*/, 28];
                    return [4 /*yield*/, readFile(envPath, 'utf-8')];
                case 26:
                    existingEnv = _c.sent();
                    newEnv = appendToEnv(existingEnv, generateEnvTemplate(connectionConfig));
                    return [4 /*yield*/, writeFile(envPath, newEnv)];
                case 27:
                    _c.sent();
                    logger.success('Updated .env');
                    return [3 /*break*/, 30];
                case 28: return [4 /*yield*/, writeFile(envPath, generateEnvTemplate(connectionConfig))];
                case 29:
                    _c.sent();
                    logger.success('Created .env');
                    _c.label = 30;
                case 30: return [3 /*break*/, 34];
                case 31:
                    envPath = path.join(process.cwd(), '.env');
                    return [4 /*yield*/, hasEnvFile()];
                case 32:
                    envExists = _c.sent();
                    placeholderConfig = {
                        host: 'YOUR_CLICKHOUSE_HOST',
                        database: 'YOUR_DATABASE',
                        username: 'YOUR_USERNAME',
                        password: 'YOUR_PASSWORD',
                    };
                    if (!!envExists) return [3 /*break*/, 34];
                    return [4 /*yield*/, writeFile(envPath, generateEnvTemplate(placeholderConfig))];
                case 33:
                    _c.sent();
                    logger.success('Created .env (configure your credentials)');
                    _c.label = 34;
                case 34:
                    schemaPath = path.join(resolvedOutputDir, 'schema.ts');
                    if (!hasValidConnection) return [3 /*break*/, 39];
                    typeSpinner = ora('Generating TypeScript types...').start();
                    _c.label = 35;
                case 35:
                    _c.trys.push([35, 37, , 38]);
                    generator = getTypeGenerator('clickhouse');
                    return [4 /*yield*/, generator({ outputPath: schemaPath })];
                case 36:
                    _c.sent();
                    typeSpinner.succeed("Generated TypeScript types (".concat(path.relative(process.cwd(), schemaPath), ")"));
                    return [3 /*break*/, 38];
                case 37:
                    error_1 = _c.sent();
                    typeSpinner.fail('Failed to generate types');
                    logger.error(error_1 instanceof Error ? error_1.message : String(error_1));
                    process.exit(1);
                    return [3 /*break*/, 38];
                case 38: return [3 /*break*/, 41];
                case 39: 
                // Create placeholder schema file
                return [4 /*yield*/, writeFile(schemaPath, "// Generated by hypequery\n// Run 'npx hypequery generate' after configuring your database connection\n\nexport interface IntrospectedSchema {\n  // Your table types will appear here after generation\n}\n")];
                case 40:
                    // Create placeholder schema file
                    _c.sent();
                    logger.success("Created placeholder schema (".concat(path.relative(process.cwd(), schemaPath), ")"));
                    _c.label = 41;
                case 41:
                    clientPath = path.join(resolvedOutputDir, 'client.ts');
                    return [4 /*yield*/, writeFile(clientPath, generateClientTemplate())];
                case 42:
                    _c.sent();
                    logger.success("Created ClickHouse client (".concat(path.relative(process.cwd(), clientPath), ")"));
                    queriesPath = path.join(resolvedOutputDir, 'queries.ts');
                    return [4 /*yield*/, writeFile(queriesPath, generateQueriesTemplate({
                            hasExample: generateExample,
                            tableName: selectedTable || undefined,
                        }))];
                case 43:
                    _c.sent();
                    logger.success("Created queries file (".concat(path.relative(process.cwd(), queriesPath), ")"));
                    if (generateExample && selectedTable) {
                        logger.success("Created example query using '".concat(selectedTable, "' table"));
                    }
                    gitignorePath = path.join(process.cwd(), '.gitignore');
                    return [4 /*yield*/, hasGitignore()];
                case 44:
                    gitignoreExists = _c.sent();
                    if (!gitignoreExists) return [3 /*break*/, 48];
                    return [4 /*yield*/, readFile(gitignorePath, 'utf-8')];
                case 45:
                    existingGitignore = _c.sent();
                    newGitignore = appendToGitignore(existingGitignore);
                    if (!(newGitignore !== existingGitignore)) return [3 /*break*/, 47];
                    return [4 /*yield*/, writeFile(gitignorePath, newGitignore)];
                case 46:
                    _c.sent();
                    logger.success('Updated .gitignore');
                    _c.label = 47;
                case 47: return [3 /*break*/, 50];
                case 48: return [4 /*yield*/, writeFile(gitignorePath, appendToGitignore(''))];
                case 49:
                    _c.sent();
                    logger.success('Created .gitignore');
                    _c.label = 50;
                case 50: 
                // Step 13: Ensure required hypequery packages are installed
                return [4 /*yield*/, installServeDependencies()];
                case 51:
                    // Step 13: Ensure required hypequery packages are installed
                    _c.sent();
                    // Step 14: Success message
                    logger.newline();
                    logger.header('Setup complete!');
                    if (hasValidConnection) {
                        logger.info('Try your first query:');
                        logger.newline();
                        logger.indent("import { api } from './".concat(path.relative(process.cwd(), queriesPath).replace(/\.ts$/, '.js'), "'"));
                        exampleQueryKey = generateExample && selectedTable
                            ? "".concat(selectedTable.replace(/_([a-z])/g, function (_, l) { return l.toUpperCase(); }), "Query")
                            : 'exampleMetric';
                        logger.indent("const result = await api.execute('".concat(exampleQueryKey, "')"));
                        logger.newline();
                        logger.info('Next:');
                        logger.indent('npx hypequery dev          Start development server');
                        logger.newline();
                    }
                    else {
                        logger.info('Next steps:');
                        logger.newline();
                        logger.indent('1. Configure your database connection in .env');
                        logger.indent('2. Run: npx hypequery generate    (to generate types)');
                        logger.indent('3. Run: npx hypequery dev          (to start dev server)');
                        logger.newline();
                    }
                    logger.info('Docs: https://hypequery.com/docs');
                    logger.newline();
                    return [2 /*return*/];
            }
        });
    });
}
