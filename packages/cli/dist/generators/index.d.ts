import type { DatabaseType } from '../utils/detect-database.js';
import { type ClickHouseGeneratorOptions } from './clickhouse.js';
export type TypeGeneratorOptions = ClickHouseGeneratorOptions;
type GeneratorFn = (options: TypeGeneratorOptions) => Promise<void>;
export declare function getTypeGenerator(dbType: DatabaseType): GeneratorFn;
export {};
//# sourceMappingURL=index.d.ts.map