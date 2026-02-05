import { type DatabaseType } from '../utils/detect-database.js';
export interface GenerateOptions {
    output?: string;
    tables?: string;
    database?: DatabaseType;
}
export declare function generateCommand(options?: GenerateOptions): Promise<void>;
//# sourceMappingURL=generate.d.ts.map