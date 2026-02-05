import { type IncomingMessage, type ServerResponse } from "http";
import type { ServeHandler, StartServerOptions } from "../types.js";
export declare const createNodeHandler: (handler: ServeHandler) => (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export declare const startNodeServer: (handler: ServeHandler, options?: StartServerOptions) => Promise<{
    server: import("http").Server<typeof IncomingMessage, typeof ServerResponse>;
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=node.d.ts.map