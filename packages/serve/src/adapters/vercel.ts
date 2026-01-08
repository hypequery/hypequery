import { createFetchHandler } from "./fetch";
import { createNodeHandler } from "./node";
import type { ServeHandler } from "../types";

type VercelEdgeHandler = (request: Request) => Promise<Response>;
type VercelNodeHandler = (req: unknown, res: unknown) => Promise<void> | void;

export const createVercelEdgeHandler = (handler: ServeHandler): VercelEdgeHandler => {
  const fetchHandler = createFetchHandler(handler);
  return async (request: Request) => fetchHandler(request);
};

export const createVercelNodeHandler = (handler: ServeHandler): VercelNodeHandler => {
  const nodeHandler = createNodeHandler(handler);
  return async (req: unknown, res: unknown) => {
    // Vercel's Node runtime passes standard Node req/res objects.
    await nodeHandler(req as any, res as any);
  };
};
