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
import fs from 'node:fs/promises';
import path from 'node:path';
import { getClickHouseClient } from '../utils/clickhouse-client.js';
var DEFAULT_WARNING = 'Warning: No tables match the filter criteria. Check your include/exclude options.';
var capitalizeFirstLetter = function (value) { return value.charAt(0).toUpperCase() + value.slice(1); };
var clickhouseToTsType = function (type) {
    if (type.startsWith('Array(')) {
        var innerType = type.slice(6, -1);
        return "Array<".concat(clickhouseToTsType(innerType), ">");
    }
    if (type.startsWith('Nullable(')) {
        var innerType = type.slice(9, -1);
        return "".concat(clickhouseToTsType(innerType), " | null");
    }
    if (type.startsWith('Map(')) {
        var mapContent = type.slice(4, -1);
        var commaIndex = mapContent.lastIndexOf(',');
        if (commaIndex !== -1) {
            var keyType = mapContent.substring(0, commaIndex).trim();
            var valueType = mapContent.substring(commaIndex + 1).trim();
            var keyTsType = 'string';
            if (keyType === 'LowCardinality(String)') {
                keyTsType = 'string';
            }
            else if (keyType.includes('Int') || keyType.includes('UInt')) {
                keyTsType = 'number';
            }
            var valueTsType = 'unknown';
            if (valueType.startsWith('Array(')) {
                var innerType = valueType.slice(6, -1);
                valueTsType = "Array<".concat(clickhouseToTsType(innerType), ">");
            }
            else if (valueType.startsWith('Nullable(')) {
                var innerType = valueType.slice(9, -1);
                valueTsType = "".concat(clickhouseToTsType(innerType), " | null");
            }
            else {
                valueTsType = clickhouseToTsType(valueType);
            }
            return "Record<".concat(keyTsType, ", ").concat(valueTsType, ">");
        }
        return 'Record<string, unknown>';
    }
    switch (type.toLowerCase()) {
        case 'string':
        case 'fixedstring':
            return 'string';
        case 'int8':
        case 'int16':
        case 'int32':
        case 'uint8':
        case 'int64':
        case 'uint16':
        case 'uint32':
        case 'uint64':
            return 'number';
        case 'uint128':
        case 'uint256':
        case 'int128':
        case 'int256':
            return 'string';
        case 'float32':
        case 'float64':
        case 'decimal':
            return 'number';
        case 'datetime':
        case 'datetime64':
        case 'date':
        case 'date32':
            return 'string';
        case 'bool':
        case 'boolean':
            return 'boolean';
        default:
            return 'string';
    }
};
function fetchTables(includeTables, excludeTables) {
    return __awaiter(this, void 0, void 0, function () {
        var client, tablesQuery, tables;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = getClickHouseClient();
                    return [4 /*yield*/, client.query({
                            query: 'SHOW TABLES',
                            format: 'JSONEachRow',
                        })];
                case 1:
                    tablesQuery = _a.sent();
                    return [4 /*yield*/, tablesQuery.json()];
                case 2:
                    tables = (_a.sent());
                    if (includeTables === null || includeTables === void 0 ? void 0 : includeTables.length) {
                        tables = tables.filter(function (table) { return includeTables.includes(table.name); });
                    }
                    if (excludeTables === null || excludeTables === void 0 ? void 0 : excludeTables.length) {
                        tables = tables.filter(function (table) { return !excludeTables.includes(table.name); });
                    }
                    return [2 /*return*/, tables];
            }
        });
    });
}
function fetchColumns(table) {
    return __awaiter(this, void 0, void 0, function () {
        var client, columnsQuery;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = getClickHouseClient();
                    return [4 /*yield*/, client.query({
                            query: "DESCRIBE TABLE ".concat(table),
                            format: 'JSONEachRow',
                        })];
                case 1:
                    columnsQuery = _a.sent();
                    return [4 /*yield*/, columnsQuery.json()];
                case 2: return [2 /*return*/, (_a.sent())];
            }
        });
    });
}
export function generateClickHouseTypes(options) {
    return __awaiter(this, void 0, void 0, function () {
        var outputPath, includeTables, excludeTables, tables, typeDefinitions, _i, tables_1, table, columns, _a, columns_1, column, clickHouseType, _b, tables_2, table, columns, _c, columns_2, column, tsType, outputDir;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    outputPath = options.outputPath, includeTables = options.includeTables, excludeTables = options.excludeTables;
                    return [4 /*yield*/, fetchTables(includeTables, excludeTables)];
                case 1:
                    tables = _d.sent();
                    if (tables.length === 0) {
                        console.warn(DEFAULT_WARNING);
                    }
                    typeDefinitions = "// Generated by hypequery\n" +
                        "// This file defines TypeScript types based on your ClickHouse database schema\n\n" +
                        "export interface IntrospectedSchema {";
                    _i = 0, tables_1 = tables;
                    _d.label = 2;
                case 2:
                    if (!(_i < tables_1.length)) return [3 /*break*/, 5];
                    table = tables_1[_i];
                    return [4 /*yield*/, fetchColumns(table.name)];
                case 3:
                    columns = _d.sent();
                    typeDefinitions += "\n  ".concat(table.name, ": {");
                    for (_a = 0, columns_1 = columns; _a < columns_1.length; _a++) {
                        column = columns_1[_a];
                        clickHouseType = column.type.replace(/'/g, "\\'");
                        typeDefinitions += "\n    '".concat(column.name, "': '").concat(clickHouseType, "';");
                    }
                    typeDefinitions += '\n  };';
                    _d.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5:
                    typeDefinitions += '\n}\n';
                    typeDefinitions += "\n// Type-safe record types for each table\n";
                    _b = 0, tables_2 = tables;
                    _d.label = 6;
                case 6:
                    if (!(_b < tables_2.length)) return [3 /*break*/, 9];
                    table = tables_2[_b];
                    return [4 /*yield*/, fetchColumns(table.name)];
                case 7:
                    columns = _d.sent();
                    typeDefinitions += "export interface ".concat(capitalizeFirstLetter(table.name), "Record {");
                    for (_c = 0, columns_2 = columns; _c < columns_2.length; _c++) {
                        column = columns_2[_c];
                        tsType = clickhouseToTsType(column.type).replace(/'/g, '');
                        typeDefinitions += "\n  '".concat(column.name, "': ").concat(tsType, ";");
                    }
                    typeDefinitions += '\n}\n\n';
                    _d.label = 8;
                case 8:
                    _b++;
                    return [3 /*break*/, 6];
                case 9:
                    outputDir = path.dirname(path.resolve(outputPath));
                    return [4 /*yield*/, fs.mkdir(outputDir, { recursive: true })];
                case 10:
                    _d.sent();
                    return [4 /*yield*/, fs.writeFile(path.resolve(outputPath), typeDefinitions)];
                case 11:
                    _d.sent();
                    return [2 /*return*/];
            }
        });
    });
}
