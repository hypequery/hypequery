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
var _a, _b, _c, _d;
import { pathToFileURL } from 'node:url';
import { access, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
if (typeof process.setMaxListeners === 'function') {
    process.setMaxListeners(0);
}
var TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
var tsconfigCache = new Map();
export function loadApiModule(modulePath) {
    return __awaiter(this, void 0, void 0, function () {
        var resolved, _a, relativePath, extension, isTypeScript, moduleUrl, _b, mod, error_1, relativePath, api, relativePath, availableExports;
        var _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    resolved = path.resolve(process.cwd(), modulePath);
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, access(resolved)];
                case 2:
                    _d.sent();
                    return [3 /*break*/, 4];
                case 3:
                    _a = _d.sent();
                    relativePath = path.relative(process.cwd(), resolved);
                    throw new Error("File not found: ".concat(relativePath, "\n\n") +
                        "Make sure the file exists and the path is correct.\n" +
                        "You can specify a different file with:\n" +
                        "  hypequery dev path/to/your/queries.ts");
                case 4:
                    extension = path.extname(resolved).toLowerCase();
                    isTypeScript = TYPESCRIPT_EXTENSIONS.has(extension);
                    if (!isTypeScript) return [3 /*break*/, 6];
                    return [4 /*yield*/, bundleTypeScriptModule(resolved)];
                case 5:
                    _b = _d.sent();
                    return [3 /*break*/, 7];
                case 6:
                    _b = "".concat(pathToFileURL(resolved).href, "?t=").concat(Date.now());
                    _d.label = 7;
                case 7:
                    moduleUrl = _b;
                    _d.label = 8;
                case 8:
                    _d.trys.push([8, 10, , 11]);
                    return [4 /*yield*/, import(moduleUrl)];
                case 9:
                    mod = _d.sent();
                    return [3 /*break*/, 11];
                case 10:
                    error_1 = _d.sent();
                    relativePath = path.relative(process.cwd(), resolved);
                    throw new Error("Failed to load module: ".concat(relativePath, "\n\n") +
                        "Error: ".concat(error_1.message, "\n\n") +
                        (error_1.code === 'ERR_MODULE_NOT_FOUND'
                            ? "This usually means:\n" +
                                "  \u2022 A dependency is missing (run 'npm install')\n" +
                                "  \u2022 An import path is incorrect\n"
                            : "") +
                        (error_1.stack ? "\nStack trace:\n".concat(error_1.stack, "\n") : ''));
                case 11:
                    api = (_c = mod.api) !== null && _c !== void 0 ? _c : mod.default;
                    if (!api || typeof api.handler !== 'function') {
                        relativePath = path.relative(process.cwd(), resolved);
                        availableExports = Object.keys(mod).filter(function (key) { return key !== '__esModule'; });
                        throw new Error("Invalid API module: ".concat(relativePath, "\n\n") +
                            "The module must export a 'defineServe' result as 'api'.\n\n" +
                            (availableExports.length > 0
                                ? "Found exports: ".concat(availableExports.join(', '), "\n\n")
                                : "No exports found in the module.\n\n") +
                            "Expected format:\n\n" +
                            "  import { initServe } from '@hypequery/serve';\n" +
                            "  \n" +
                            "  const { define, queries, query } = initServe({\n" +
                            "    context: () => ({ db }),\n" +
                            "  });\n" +
                            "  \n" +
                            "  export const api = define({\n" +
                            "    queries: queries({\n" +
                            "      myQuery: query.query(async ({ ctx }) => {\n" +
                            "        // ...\n" +
                            "      }),\n" +
                            "    }),\n" +
                            "  });\n");
                    }
                    return [2 /*return*/, api];
            }
        });
    });
}
var globalState = globalThis;
var tempDirPromise = (_a = globalState.__hypequeryCliTempDirPromise) !== null && _a !== void 0 ? _a : null;
var tempFiles = (_b = globalState.__hypequeryCliTempFiles) !== null && _b !== void 0 ? _b : new Set();
var tempDirs = (_c = globalState.__hypequeryCliTempDirs) !== null && _c !== void 0 ? _c : new Set();
var cleanupHooksInstalled = (_d = globalState.__hypequeryCliCleanupInstalled) !== null && _d !== void 0 ? _d : false;
if (!globalState.__hypequeryCliTempFiles) {
    globalState.__hypequeryCliTempFiles = tempFiles;
}
if (!globalState.__hypequeryCliTempDirs) {
    globalState.__hypequeryCliTempDirs = tempDirs;
}
function ensureTempDir() {
    var _this = this;
    installCleanupHooks();
    if (!tempDirPromise) {
        tempDirPromise = (function () { return __awaiter(_this, void 0, void 0, function () {
            var projectTempRoot, dir, _a, fallbackDir;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        projectTempRoot = path.join(process.cwd(), '.hypequery', 'tmp');
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 4, , 6]);
                        return [4 /*yield*/, mkdir(projectTempRoot, { recursive: true })];
                    case 2:
                        _b.sent();
                        return [4 /*yield*/, mkdtemp(path.join(projectTempRoot, 'bundle-'))];
                    case 3:
                        dir = _b.sent();
                        tempDirs.add(dir);
                        return [2 /*return*/, dir];
                    case 4:
                        _a = _b.sent();
                        return [4 /*yield*/, mkdtemp(path.join(os.tmpdir(), 'hypequery-cli-'))];
                    case 5:
                        fallbackDir = _b.sent();
                        tempDirs.add(fallbackDir);
                        return [2 /*return*/, fallbackDir];
                    case 6: return [2 /*return*/];
                }
            });
        }); })();
        globalState.__hypequeryCliTempDirPromise = tempDirPromise;
    }
    return tempDirPromise;
}
function cleanupTempFiles() {
    return __awaiter(this, void 0, void 0, function () {
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (tempFiles.size === 0)
                        return [2 /*return*/];
                    return [4 /*yield*/, Promise.all(Array.from(tempFiles).map(function (file) { return __awaiter(_this, void 0, void 0, function () {
                            var _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        _b.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, rm(file, { force: true })];
                                    case 1:
                                        _b.sent();
                                        return [3 /*break*/, 3];
                                    case 2:
                                        _a = _b.sent();
                                        return [3 /*break*/, 3];
                                    case 3: return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 1:
                    _a.sent();
                    tempFiles.clear();
                    return [2 /*return*/];
            }
        });
    });
}
function cleanupTempDirs() {
    return __awaiter(this, void 0, void 0, function () {
        var projectTempRoot, _a;
        var _this = this;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (tempDirs.size === 0)
                        return [2 /*return*/];
                    return [4 /*yield*/, Promise.all(Array.from(tempDirs).map(function (dir) { return __awaiter(_this, void 0, void 0, function () {
                            var _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        _b.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, rm(dir, { recursive: true, force: true })];
                                    case 1:
                                        _b.sent();
                                        return [3 /*break*/, 3];
                                    case 2:
                                        _a = _b.sent();
                                        return [3 /*break*/, 3];
                                    case 3: return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 1:
                    _b.sent();
                    tempDirs.clear();
                    projectTempRoot = path.join(process.cwd(), '.hypequery', 'tmp');
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, rm(projectTempRoot, { recursive: true, force: true })];
                case 3:
                    _b.sent();
                    return [3 /*break*/, 5];
                case 4:
                    _a = _b.sent();
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
function cleanupTempArtifacts() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, cleanupTempFiles()];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, cleanupTempDirs()];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function installCleanupHooks() {
    if (cleanupHooksInstalled)
        return;
    cleanupHooksInstalled = true;
    globalState.__hypequeryCliCleanupInstalled = true;
    process.once('exit', function () {
        cleanupTempArtifacts().catch(function () { return undefined; });
    });
    ['SIGINT', 'SIGTERM'].forEach(function (signal) {
        process.once(signal, function () {
            cleanupTempArtifacts().catch(function () { return undefined; });
            process.exit();
        });
    });
}
function bundleTypeScriptModule(entryPath) {
    return __awaiter(this, void 0, void 0, function () {
        var relativePath, tsconfigPath, result, output, contents, tempDir, tempFile, error_2;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    relativePath = path.relative(process.cwd(), entryPath);
                    return [4 /*yield*/, findNearestTsconfig(entryPath)];
                case 1:
                    tsconfigPath = _e.sent();
                    _e.label = 2;
                case 2:
                    _e.trys.push([2, 6, , 7]);
                    return [4 /*yield*/, build({
                            entryPoints: [entryPath],
                            bundle: true,
                            format: 'esm',
                            platform: 'node',
                            target: ['node18'],
                            sourcemap: 'inline',
                            write: false,
                            logLevel: 'silent',
                            absWorkingDir: process.cwd(),
                            packages: 'external',
                            tsconfig: tsconfigPath !== null && tsconfigPath !== void 0 ? tsconfigPath : undefined,
                            loader: {
                                '.ts': 'ts',
                                '.tsx': 'tsx',
                                '.mts': 'ts',
                                '.cts': 'ts',
                            },
                        })];
                case 3:
                    result = _e.sent();
                    output = (_b = (_a = result.outputFiles) === null || _a === void 0 ? void 0 : _a.find(function (file) { return file.path.endsWith('.js'); })) !== null && _b !== void 0 ? _b : (_c = result.outputFiles) === null || _c === void 0 ? void 0 : _c[0];
                    if (!output) {
                        throw new Error('esbuild produced no output');
                    }
                    contents = "".concat(output.text, "\n//# sourceURL=").concat(pathToFileURL(entryPath).href);
                    return [4 /*yield*/, ensureTempDir()];
                case 4:
                    tempDir = _e.sent();
                    tempFile = path.join(tempDir, "".concat(path.basename(entryPath).replace(/[^a-zA-Z0-9_-]/g, '_'), "-").concat(Date.now(), "-").concat(Math.random().toString(36).slice(2), ".mjs"));
                    return [4 /*yield*/, writeFile(tempFile, contents, 'utf8')];
                case 5:
                    _e.sent();
                    tempFiles.add(tempFile);
                    return [2 /*return*/, "".concat(pathToFileURL(tempFile).href, "?t=").concat(Date.now())];
                case 6:
                    error_2 = _e.sent();
                    throw new Error("Failed to compile ".concat(relativePath, " with esbuild.\n") +
                        "Original error: ".concat((_d = error_2 === null || error_2 === void 0 ? void 0 : error_2.message) !== null && _d !== void 0 ? _d : error_2));
                case 7: return [2 /*return*/];
            }
        });
    });
}
function findNearestTsconfig(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var dir, visited, _loop_1, state_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    dir = path.dirname(filePath);
                    visited = [];
                    _loop_1 = function () {
                        var cached_1, candidate, _c, parent_1;
                        return __generator(this, function (_d) {
                            switch (_d.label) {
                                case 0:
                                    if (tsconfigCache.has(dir)) {
                                        cached_1 = (_a = tsconfigCache.get(dir)) !== null && _a !== void 0 ? _a : null;
                                        visited.forEach(function (pathname) { return tsconfigCache.set(pathname, cached_1); });
                                        return [2 /*return*/, { value: cached_1 }];
                                    }
                                    visited.push(dir);
                                    candidate = path.join(dir, 'tsconfig.json');
                                    _d.label = 1;
                                case 1:
                                    _d.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, access(candidate)];
                                case 2:
                                    _d.sent();
                                    tsconfigCache.set(dir, candidate);
                                    visited.forEach(function (pathname) { return tsconfigCache.set(pathname, candidate); });
                                    return [2 /*return*/, { value: candidate }];
                                case 3:
                                    _c = _d.sent();
                                    parent_1 = path.dirname(dir);
                                    if (parent_1 === dir) {
                                        visited.forEach(function (pathname) { return tsconfigCache.set(pathname, null); });
                                        return [2 /*return*/, { value: null }];
                                    }
                                    dir = parent_1;
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    };
                    _b.label = 1;
                case 1:
                    if (!true) return [3 /*break*/, 3];
                    return [5 /*yield**/, _loop_1()];
                case 2:
                    state_1 = _b.sent();
                    if (typeof state_1 === "object")
                        return [2 /*return*/, state_1.value];
                    return [3 /*break*/, 1];
                case 3: return [2 /*return*/];
            }
        });
    });
}
