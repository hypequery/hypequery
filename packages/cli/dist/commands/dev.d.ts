export interface DevOptions {
    port?: number;
    hostname?: string;
    watch?: boolean;
    quiet?: boolean;
    cache?: string;
    redisUrl?: string;
    open?: boolean;
    cors?: boolean;
}
export declare function devCommand(file?: string, options?: DevOptions): Promise<void>;
//# sourceMappingURL=dev.d.ts.map