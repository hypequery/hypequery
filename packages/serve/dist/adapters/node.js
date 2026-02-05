import { createServer } from "http";
import { once } from "node:events";
import { normalizeHeaders, parseQueryParams, parseRequestBody, serializeResponseBody, } from "./utils.js";
const readRequestBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
};
const buildServeRequest = async (req) => {
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", "http://localhost");
    const bodyBuffer = await readRequestBody(req);
    const headers = normalizeHeaders(req.headers);
    const contentType = headers["content-type"] ?? headers["Content-Type"];
    const body = await parseRequestBody(bodyBuffer, contentType);
    return {
        method,
        path: url.pathname,
        query: parseQueryParams(url.searchParams),
        headers,
        body,
        raw: req,
    };
};
const sendResponse = (res, response) => {
    res.statusCode = response.status;
    const headers = response.headers ?? {};
    for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) {
            res.setHeader(key, value);
        }
    }
    if (!res.hasHeader("content-type")) {
        res.setHeader("content-type", "application/json; charset=utf-8");
    }
    const serialized = serializeResponseBody(response.body);
    res.end(serialized);
};
const sendError = (res, error) => {
    const payload = error && typeof error === "object" && "status" in error
        ? error
        : {
            status: 500,
            body: {
                error: {
                    type: "INTERNAL_SERVER_ERROR",
                    message: error instanceof Error ? error.message : "Unexpected error",
                },
            },
        };
    sendResponse(res, payload);
};
export const createNodeHandler = (handler) => {
    return async (req, res) => {
        try {
            const request = await buildServeRequest(req);
            const response = await handler(request);
            sendResponse(res, response);
        }
        catch (error) {
            sendError(res, error);
        }
    };
};
export const startNodeServer = async (handler, options = {}) => {
    const listener = createNodeHandler(handler);
    const server = createServer(listener);
    const port = options.port ?? 3000;
    const hostname = options.hostname ?? "0.0.0.0";
    const onAbort = () => {
        server.close();
    };
    if (options.signal) {
        if (options.signal.aborted) {
            server.close();
            throw new Error("Start signal already aborted");
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
    }
    server.listen(port, hostname);
    await once(server, "listening");
    if (!options.quiet) {
        const address = server.address();
        const display = typeof address === "object" && address
            ? `${address.address}:${address.port}`
            : `${hostname}:${port}`;
        console.log(`hypequery serve listening on ${display}`);
    }
    const stop = () => new Promise((resolve, reject) => {
        server.close((err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
    return {
        server,
        stop,
    };
};
