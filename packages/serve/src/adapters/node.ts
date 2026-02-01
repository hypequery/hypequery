import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { once } from "node:events";

import type {
  HttpMethod,
  ServeHandler,
  ServeRequest,
  ServeResponse,
  StartServerOptions,
} from "../types.js";
import {
  normalizeHeaders,
  parseQueryParams,
  parseRequestBody,
  serializeResponseBody,
} from "./utils.js";

const DEFAULT_REQUEST_TIMEOUT = 30_000; // 30 seconds
const DEFAULT_BODY_LIMIT = 1_048_576; // 1 MB
const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT = 10_000; // 10 seconds

const readRequestBody = async (
  req: IncomingMessage,
  bodyLimit: number,
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let totalLength = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLength += buf.length;

    if (bodyLimit > 0 && totalLength > bodyLimit) {
      // Destroy the stream to stop reading
      req.destroy();
      const error = new Error("Request body too large");
      (error as any).code = "PAYLOAD_TOO_LARGE";
      throw error;
    }

    chunks.push(buf);
  }

  return Buffer.concat(chunks);
};

const buildServeRequest = async (
  req: IncomingMessage,
  bodyLimit: number,
): Promise<ServeRequest> => {
  const method = (req.method ?? "GET").toUpperCase() as HttpMethod;
  const url = new URL(req.url ?? "/", "http://localhost");
  const bodyBuffer = await readRequestBody(req, bodyLimit);
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

const sendResponse = (res: ServerResponse, response: ServeResponse) => {
  if (res.writableEnded) return;

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

const sendError = (res: ServerResponse, error: unknown) => {
  if (res.writableEnded) return;

  // Handle body-too-large errors
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as any).code === "PAYLOAD_TOO_LARGE"
  ) {
    sendResponse(res, {
      status: 413,
      body: {
        error: {
          type: "PAYLOAD_TOO_LARGE",
          message: "Request body exceeds the configured size limit",
        },
      },
    });
    return;
  }

  const payload =
    error && typeof error === "object" && "status" in error
      ? (error as ServeResponse)
      : {
          status: 500,
          body: {
            error: {
              type: "INTERNAL_SERVER_ERROR",
              message:
                error instanceof Error ? error.message : "Unexpected error",
            },
          },
        } satisfies ServeResponse;

  sendResponse(res, payload);
};

export const createNodeHandler = (
  handler: ServeHandler,
  options: StartServerOptions = {},
) => {
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const requestTimeout = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const request = await buildServeRequest(req, bodyLimit);

      if (requestTimeout > 0) {
        // Race the handler against the timeout
        const timeoutPromise = new Promise<ServeResponse>((resolve) => {
          const timer = setTimeout(() => {
            resolve({
              status: 504,
              body: {
                error: {
                  type: "GATEWAY_TIMEOUT" as const,
                  message: `Request timed out after ${requestTimeout}ms`,
                },
              },
            });
          }, requestTimeout);
          // Unref so the timer doesn't keep the process alive during shutdown
          timer.unref();
        });

        const response = await Promise.race([
          handler(request),
          timeoutPromise,
        ]);
        sendResponse(res, response);
      } else {
        const response = await handler(request);
        sendResponse(res, response);
      }
    } catch (error) {
      sendError(res, error);
    }
  };
};

export const startNodeServer = async (
  handler: ServeHandler,
  options: StartServerOptions = {},
) => {
  const listener = createNodeHandler(handler, options);
  const server = createServer(listener);
  const port = options.port ?? 3000;
  const hostname = options.hostname ?? "0.0.0.0";
  const gracefulShutdownTimeout =
    options.gracefulShutdownTimeout ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT;

  // Track in-flight requests for graceful shutdown
  let inFlightRequests = 0;
  let isDraining = false;

  server.on("request", (_req: IncomingMessage, res: ServerResponse) => {
    inFlightRequests++;

    if (isDraining) {
      // Signal to the client that the connection will close
      res.setHeader("connection", "close");
    }

    res.on("close", () => {
      inFlightRequests--;
    });
  });

  const gracefulStop = (): Promise<void> =>
    new Promise<void>((resolve) => {
      isDraining = true;

      // Stop accepting new connections
      server.close(() => {
        resolve();
      });

      // If there are no in-flight requests, we're done once server.close completes
      if (inFlightRequests === 0) {
        return;
      }

      // Wait for in-flight requests, with a hard deadline
      const deadline = setTimeout(() => {
        if (!options.quiet) {
          console.log(
            `[hypequery/serve] Forcing shutdown with ${inFlightRequests} in-flight request(s)`,
          );
        }
        // Force-close all remaining connections
        server.closeAllConnections();
      }, gracefulShutdownTimeout);
      deadline.unref();

      // Also resolve early if all requests finish before the deadline
      const checkInterval = setInterval(() => {
        if (inFlightRequests <= 0) {
          clearTimeout(deadline);
          clearInterval(checkInterval);
          // server.close callback will resolve the promise
        }
      }, 50);
      checkInterval.unref();
    });

  const onAbort = () => {
    gracefulStop();
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
    console.log(`hypequery serve listening on ${display}`);
  }

  return {
    server,
    stop: gracefulStop,
  };
};
