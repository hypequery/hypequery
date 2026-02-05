import type { ServeHandler } from "../types.js";
type VercelEdgeHandler = (request: Request) => Promise<Response>;
type VercelNodeHandler = (req: unknown, res: unknown) => Promise<void> | void;
export declare const createVercelEdgeHandler: (handler: ServeHandler) => VercelEdgeHandler;
export declare const createVercelNodeHandler: (handler: ServeHandler) => VercelNodeHandler;
export {};
//# sourceMappingURL=vercel.d.ts.map