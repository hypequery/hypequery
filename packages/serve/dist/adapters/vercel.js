import { createFetchHandler } from "./fetch.js";
import { createNodeHandler } from "./node.js";
export const createVercelEdgeHandler = (handler) => {
    const fetchHandler = createFetchHandler(handler);
    return async (request) => fetchHandler(request);
};
export const createVercelNodeHandler = (handler) => {
    const nodeHandler = createNodeHandler(handler);
    return async (req, res) => {
        // Vercel's Node runtime passes standard Node req/res objects.
        await nodeHandler(req, res);
    };
};
