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
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { logger } from './logger.js';
var REQUIRED_PACKAGES = ['@hypequery/clickhouse', '@hypequery/serve'];
var MANUAL_COMMANDS = {
    pnpm: 'pnpm add',
    yarn: 'yarn add',
    npm: 'npm install',
    bun: 'bun add',
};
function hasDependency(pkg, name) {
    var _a, _b, _c;
    return Boolean((_b = (_a = pkg.dependencies) === null || _a === void 0 ? void 0 : _a[name]) !== null && _b !== void 0 ? _b : (_c = pkg.devDependencies) === null || _c === void 0 ? void 0 : _c[name]);
}
function readProjectPackageJson() {
    return __awaiter(this, void 0, void 0, function () {
        var file, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, readFile(path.join(process.cwd(), 'package.json'), 'utf8')];
                case 1:
                    file = _b.sent();
                    return [2 /*return*/, JSON.parse(file)];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function detectPackageManager(pkgJson) {
    var _a, _b;
    var userAgent = (_a = process.env.npm_config_user_agent) !== null && _a !== void 0 ? _a : '';
    if (userAgent.includes('pnpm'))
        return 'pnpm';
    if (userAgent.includes('yarn'))
        return 'yarn';
    if (userAgent.includes('bun'))
        return 'bun';
    var declared = (_b = pkgJson === null || pkgJson === void 0 ? void 0 : pkgJson.packageManager) !== null && _b !== void 0 ? _b : '';
    if (declared.startsWith('pnpm'))
        return 'pnpm';
    if (declared.startsWith('yarn'))
        return 'yarn';
    if (declared.startsWith('bun'))
        return 'bun';
    var cwd = process.cwd();
    if (existsSync(path.join(cwd, 'pnpm-lock.yaml')))
        return 'pnpm';
    if (existsSync(path.join(cwd, 'yarn.lock')))
        return 'yarn';
    if (existsSync(path.join(cwd, 'bun.lockb')))
        return 'bun';
    return 'npm';
}
function getInstallArgs(manager, packages) {
    switch (manager) {
        case 'pnpm':
            return __spreadArray(['add'], packages, true);
        case 'yarn':
            return __spreadArray(['add'], packages, true);
        case 'bun':
            return __spreadArray(['add'], packages, true);
        case 'npm':
        default:
            return __spreadArray(['install'], packages, true);
    }
}
function formatManualCommand(manager, packages) {
    return "".concat(MANUAL_COMMANDS[manager], " ").concat(packages.join(' '));
}
export function installServeDependencies() {
    return __awaiter(this, void 0, void 0, function () {
        var pkgJson, missing, manager, command, args, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (process.env.HYPEQUERY_SKIP_INSTALL === '1') {
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, readProjectPackageJson()];
                case 1:
                    pkgJson = _a.sent();
                    if (!pkgJson) {
                        logger.warn('package.json not found. Install @hypequery/clickhouse and @hypequery/serve manually.');
                        return [2 /*return*/];
                    }
                    missing = REQUIRED_PACKAGES.filter(function (pkg) { return !hasDependency(pkgJson, pkg); });
                    if (missing.length === 0) {
                        return [2 /*return*/];
                    }
                    manager = detectPackageManager(pkgJson);
                    command = manager === 'npm' ? 'npm' : manager;
                    args = getInstallArgs(manager, missing);
                    logger.info("Installing ".concat(missing.join(', '), " with ").concat(manager, "..."));
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var child = spawn(command, args, {
                                cwd: process.cwd(),
                                stdio: 'inherit',
                            });
                            child.on('error', reject);
                            child.on('close', function (code) {
                                if (code === 0) {
                                    resolve();
                                }
                                else {
                                    reject(new Error("".concat(command, " exited with code ").concat(code)));
                                }
                            });
                        })];
                case 3:
                    _a.sent();
                    logger.success("Installed ".concat(missing.join(', ')));
                    return [3 /*break*/, 5];
                case 4:
                    error_1 = _a.sent();
                    logger.warn('Failed to install hypequery packages automatically.');
                    logger.info("Run manually: ".concat(formatManualCommand(manager, missing)));
                    if (error_1 instanceof Error && error_1.message) {
                        logger.info(error_1.message);
                    }
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
