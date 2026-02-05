import type { CacheStatus } from '../cache/types.js';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface QueryLog {
    query: string;
    parameters?: any[];
    startTime: number;
    endTime?: number;
    duration?: number;
    status: 'started' | 'completed' | 'error';
    error?: Error;
    rowCount?: number;
    queryId?: string;
    cacheStatus?: CacheStatus;
    cacheKey?: string;
    cacheMode?: string;
    cacheAgeMs?: number;
    cacheRowCount?: number;
}
export interface LoggerOptions {
    level?: LogLevel;
    enabled?: boolean;
    onQueryLog?: (log: QueryLog) => void;
}
declare class Logger {
    private static instance;
    private level;
    private enabled;
    private onQueryLog?;
    private querySubscribers;
    private constructor();
    static getInstance(): Logger;
    configure(options: LoggerOptions): void;
    subscribeToQuery(queryId: string, callback: (log: QueryLog) => void): () => void;
    private shouldLog;
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    logQuery(log: QueryLog): void;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map