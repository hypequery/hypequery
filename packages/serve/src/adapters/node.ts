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
import { adapterErrorHeaders } from "../utils/error-headers.js";
import {
  declaresRequestBody,
  isNodeBodyConsumed,
  readPreParsedBody,
  resolveNodeRequestUrl,
} from "../utils/node-request.js";

const DEFAULT_REQUEST_TIMEOUT = 30_000; // 30 seconds
const DEFAULT_BODY_LIMIT = 1_048_576; // 1 MB
const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT = 10_000; // 10 seconds

const payloadTooLarge = () => {
  const error = new Error("Request body too large");
  (error as any).code = "PAYLOAD_TOO_LARGE";
  return error;
};

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
      throw payloadTooLarge();
    }

    chunks.push(buf);
  }

  return Buffer.concat(chunks);
};

const resolveRequestBody = async (
  req: IncomingMessage,
  bodyLimit: number,
  contentType: string | undefined,
): Promise<unknown> => {
  if (!isNodeBodyConsumed(req)) {
    return parseRequestBody(await readRequestBody(req, bodyLimit), contentType);
  }

  // A body parser (express.json(), NestJS, koa-bodyparser, ...) already read
  // the stream. Use what it left on req.body; it has applied its own limit.
  const preParsed = readPreParsedBody(req);
  if (preParsed.kind === "parsed") return preParsed.value;
  if (preParsed.kind === "raw") {
    if (bodyLimit > 0 && preParsed.buffer.length > bodyLimit) {
      throw payloadTooLarge();
    }
    return parseRequestBody(preParsed.buffer, contentType);
  }

  if (declaresRequestBody(req)) {
    // The body is gone and nothing exposed it. Fail loudly rather than
    // validating an empty body and returning a misleading 400.
    throw {
      status: 500,
      body: {
        error: {
          type: "INTERNAL_SERVER_ERROR",
          message:
            "The request body was consumed before the hypequery handler ran. " +
            "Register the handler before body-parsing middleware, or set " +
            "req.body to the parsed body (for Fastify: request.raw.body = request.body).",
        },
      },
    } satisfies ServeResponse;
  }

  return undefined;
};

const buildServeRequest = async (
  req: IncomingMessage,
  bodyLimit: number,
): Promise<ServeRequest> => {
  const method = (req.method ?? "GET").toUpperCase() as HttpMethod;
  const url = new URL(resolveNodeRequestUrl(req), "http://localhost");
  const headers = normalizeHeaders(req.headers);
  const contentType = headers["content-type"] ?? headers["Content-Type"];
  const body = await resolveRequestBody(req, bodyLimit, contentType);

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
  // headersSent guards against a mount handler that wrote part of a response
  // and then threw: status/headers can no longer be changed at that point.
  if (res.writableEnded || res.headersSent) return;

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
  if (res.headersSent) {
    // A handler already streamed part of a response and then failed; an error
    // status can no longer be sent. End the response so the connection does
    // not hang open until timeout.
    res.end();
    return;
  }

  // Handle body-too-large errors
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as any).code === "PAYLOAD_TOO_LARGE"
  ) {
    sendResponse(res, {
      status: 413,
      headers: adapterErrorHeaders(),
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
              // Never the thrown message: an error escaping the pipeline can
              // carry a stack, a file path, SQL, or a driver detail.
              message: "An unexpected error occurred",
            },
          },
        } satisfies ServeResponse;

  sendResponse(res, {
    ...payload,
    // A thrown response-shaped object is still an adapter error. These
    // headers must override any supplied casing or value.
    headers: adapterErrorHeaders(payload.headers),
  });
};

export const createNodeHandler = (
  handler: ServeHandler,
  options: StartServerOptions = {},
) => {
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const requestTimeout = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (options.mount && (await options.mount(req, res))) {
        return;
      }

      const request = await buildServeRequest(req, bodyLimit);

      if (requestTimeout > 0) {
        // Race the handler against the timeout
        const timeoutPromise = new Promise<ServeResponse>((resolve) => {
          const timer = setTimeout(() => {
            resolve({
              status: 504,
              headers: adapterErrorHeaders(),
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
