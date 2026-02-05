import type { EndpointRegistry, HttpMethod, ServeEndpoint } from "./types.js";
export declare const normalizeRoutePath: (path: string) => string;
export declare const applyBasePath: (basePath: string, path: string) => string;
export declare class ServeRouter implements EndpointRegistry {
    private readonly basePath;
    private routes;
    constructor(basePath?: string);
    list(): ServeEndpoint<any, any, any, any, any>[];
    register(endpoint: ServeEndpoint<any, any, any, any>): void;
    match(method: HttpMethod, path: string): ServeEndpoint<any, any, any, any, any> | null;
    markRoutesRequireAuth(): void;
}
//# sourceMappingURL=router.d.ts.map