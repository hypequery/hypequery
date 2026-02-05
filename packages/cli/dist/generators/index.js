import { generateClickHouseTypes } from './clickhouse.js';
var generators = {
    clickhouse: generateClickHouseTypes,
};
export function getTypeGenerator(dbType) {
    var generator = generators[dbType];
    if (!generator) {
        throw new Error(dbType === 'unknown'
            ? 'Unable to detect database type. Re-run `hypequery init --database <type>` or pass `--database` explicitly.'
            : "Type generation for ".concat(dbType, " is not supported yet."));
    }
    return generator;
}
