/**
 * Calm, professional CLI logger
 * Follows Vercel-style output: informative, actionable, no noise
 */
export declare class Logger {
    private quiet;
    constructor(quiet?: boolean);
    /**
     * Success message with checkmark
     */
    success(message: string): void;
    /**
     * Error message with X mark
     */
    error(message: string): void;
    /**
     * Warning message with warning symbol
     */
    warn(message: string): void;
    /**
     * Info message (no symbol)
     */
    info(message: string): void;
    /**
     * Reload/change message
     */
    reload(message: string): void;
    /**
     * Section header
     */
    header(message: string): void;
    /**
     * Empty line
     */
    newline(): void;
    /**
     * Indented message (for sub-items)
     */
    indent(message: string): void;
    /**
     * Boxed URL output
     */
    box(lines: string[]): void;
    /**
     * Table output (for dev server stats)
     */
    table(headers: string[], rows: string[][]): void;
    /**
     * Raw console.log (bypass quiet mode)
     */
    raw(message: string): void;
}
export declare const logger: Logger;
//# sourceMappingURL=logger.d.ts.map