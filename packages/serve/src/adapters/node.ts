import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { once } from "node:events";

import type {
  HttpMethod,
  ServeHandler,
  ServeRequest,
  ServeResponse,
  StartServerOptions,
} from "../types.js";

const readRequestBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

const parseJsonBody = (raw: Buffer): unknown => {
  if (!raw.length) {
    return undefined;
  }

  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return raw.toString("utf8");
  }
};

const toServeHeaders = (req: IncomingMessage) => {
  const headers: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers[key] = value.join(", ");
    } else if (typeof value === "string") {
      headers[key] = value;
    }
  }

  return headers;
};

const toQueryParams = (url: URL) => {
  const params: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of url.searchParams.entries()) {
    if (params[key] === undefined) {
      params[key] = value;
    } else if (Array.isArray(params[key])) {
      (params[key] as string[]).push(value);
    } else {
      params[key] = [params[key] as string, value];
    }
  }

  return params;
};

const buildServeRequest = async (req: IncomingMessage): Promise<ServeRequest> => {
  const method = (req.method ?? "GET").toUpperCase() as HttpMethod;
  const url = new URL(req.url ?? "/", "http://localhost");
  const bodyBuffer = await readRequestBody(req);
  const headers = toServeHeaders(req);
  const contentType = headers["content-type"] ?? headers["Content-Type"];
  let body: unknown;

  if (contentType && contentType.includes("application/json")) {
    body = parseJsonBody(bodyBuffer);
  } else if (bodyBuffer.length) {
    body = bodyBuffer.toString("utf8");
  }

  return {
    method,
    path: url.pathname,
    query: toQueryParams(url),
    headers,
    body,
    raw: req,
  };
};

const sendResponse = (res: ServerResponse, response: ServeResponse) => {
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

  const contentType = res.getHeader("content-type");
  const isJson = typeof contentType === "string" && contentType.includes("application/json");

  if (isJson) {
    res.end(JSON.stringify(response.body ?? null));
  } else if (typeof response.body === "string") {
    res.end(response.body);
  } else {
    res.end(JSON.stringify(response.body ?? null));
  }
};

const sendError = (res: ServerResponse, error: unknown) => {
  const payload =
    error && typeof error === "object" && "status" in error
      ? (error as ServeResponse)
      : {
          status: 500,
          body: {
            error: {
              type: "INTERNAL_SERVER_ERROR",
              message: error instanceof Error ? error.message : "Unexpected error",
            },
          },
        } satisfies ServeResponse;

  sendResponse(res, payload);
};

export const createNodeHandler = (handler: ServeHandler) => {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const request = await buildServeRequest(req);
      const response = await handler(request);
      sendResponse(res, response);
    } catch (error) {
      sendError(res, error);
    }
  };
};

export const startNodeServer = async (
  handler: ServeHandler,
  options: StartServerOptions = {}
) => {
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
    const display =
      typeof address === "object" && address
        ? `${address.address}:${address.port}`
        : `${hostname}:${port}`;
    console.log(`HypeQuery serve listening on ${display}`);
  }

  const stop = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

  return {
    server,
    stop,
  };
};
