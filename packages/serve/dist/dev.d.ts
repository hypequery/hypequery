import type { ServeBuilder, StartServerOptions } from "./types.js";
export interface ServeDevOptions extends StartServerOptions {
    logger?: (message: string) => void;
}
export declare const serveDev: <TQueries extends Record<string, any>, TAuth extends Record<string, unknown>>(api: ServeBuilder<TQueries, TAuth>, options?: ServeDevOptions) => Promise<{
    server: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=dev.d.ts.map