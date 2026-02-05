export interface InitOptions {
    database?: string;
    path?: string;
    noExample?: boolean;
    noInteractive?: boolean;
    force?: boolean;
    skipConnection?: boolean;
}
export declare function initCommand(options?: InitOptions): Promise<void>;
//# sourceMappingURL=init.d.ts.map