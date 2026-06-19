import { request as httpRequest } from "http";
import { Readable } from "stream";
import { describe, expect, it } from "vitest";

import { createNodeHandler, startNodeServer } from "./node";
import type { ServeHandler } from "../types";

type MockHeaders = Record<string, string | string[] | undefined>;

const createMockRequest = (options: {
  method?: string;
  url?: string;
  headers?: MockHeaders;
  body?: unknown;
}) => {
  const body =
    options.body === undefined
      ? null
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);

  const readable = new Readable({
    read() {
      if (body !== null) {
        this.push(body);
      }
      this.push(null);
    },
  });

  return Object.assign(readable, {
    method: options.method ?? "POST",
    url: options.url ?? "/metrics?foo=bar&foo=baz",
    headers: options.headers ?? { "content-type": "application/json" },
  }) as any;
};

class MockResponse {
  public statusCode = 0;
  private headers: Record<string, string> = {};
  public body = "";

  setHeader(key: string, value: string) {
    this.headers[key.toLowerCase()] = value;
  }

  hasHeader(key: string) {
    return key.toLowerCase() in this.headers;
  }

  getHeader(key: string) {
    return this.headers[key.toLowerCase()];
  }

  end(payload?: string) {
    this.body = payload ?? "";
  }
}

const serverUrl = (server: Awaited<ReturnType<typeof startNodeServer>>["server"]) => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
};

const requestWithNodeHttp = (
  url: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
) => new Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
  const body = options.body ?? "";
  const headers: Record<string, string> = {
    connection: "close",
    ...options.headers,
  };
  if (body) {
    headers["content-length"] = String(Buffer.byteLength(body));
  }

  const req = httpRequest(url, {
    method: options.method ?? "GET",
    headers,
  }, (res) => {
    let responseBody = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      responseBody += chunk;
    });
    res.on("end", () => {
      resolve({
        status: res.statusCode ?? 0,
        body: responseBody,
        headers: res.headers,
      });
    });
  });
  req.on("error", reject);
  req.end(body);
});

const postWithNodeHttp = (
  url: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> =>
  requestWithNodeHttp(url, {
    method: "POST",
    body,
    headers,
  });

describe("createNodeHandler", () => {
  it("adapts Node HTTP requests to the serve handler", async () => {
    const handler: ServeHandler = async (request) => ({
      status: 200,
      body: {
        path: request.path,
        query: request.query,
        body: request.body,
      },
    });

    const listener = createNodeHandler(handler);
    const response = new MockResponse();

    await listener(
      createMockRequest({ body: { hello: "world" } }) as any,
      response as any
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      path: "/metrics",
      query: { foo: ["bar", "baz"] },
      body: { hello: "world" },
    });
  });

  describe("Error handling", () => {
    it("handles malformed JSON gracefully", async () => {
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { receivedBody: request.body },
      });

      const listener = createNodeHandler(handler);
      const response = new MockResponse();

      await listener(
        createMockRequest({
          body: "{invalid json",
          headers: { "content-type": "application/json" },
        }) as any,
        response as any
      );

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      // Malformed JSON should be returned as string
      expect(result.receivedBody).toBe("{invalid json");
    });

    it("handles missing Content-Type header", async () => {
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { body: request.body },
      });

      const listener = createNodeHandler(handler);
      const response = new MockResponse();

      await listener(
        createMockRequest({
          body: "plain text",
          headers: {},
        }) as any,
        response as any
      );

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.body).toBe("plain text");
    });

    it("handles empty request body", async () => {
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { hasBody: request.body !== undefined },
      });

      const listener = createNodeHandler(handler);
      const response = new MockResponse();

      await listener(
        createMockRequest({
          body: undefined,
          headers: { "content-type": "application/json" },
        }) as any,
        response as any
      );

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.hasBody).toBe(false);
    });

    it("handles non-JSON content types", async () => {
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { receivedBody: request.body },
      });

      const listener = createNodeHandler(handler);
      const response = new MockResponse();

      await listener(
        createMockRequest({
          body: "plain text content",
          headers: { "content-type": "text/plain" },
        }) as any,
        response as any
      );

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.receivedBody).toBe("plain text content");
    });

    it("handles handler errors", async () => {
      const handler: ServeHandler = async () => {
        throw new Error("Handler error");
      };

      const listener = createNodeHandler(handler);
      const response = new MockResponse();

      await listener(createMockRequest({}) as any, response as any);

      expect(response.statusCode).toBe(500);
      const result = JSON.parse(response.body);
      expect(result.error.type).toBe("INTERNAL_SERVER_ERROR");
      expect(result.error.message).toBe("Handler error");
    });

    it("handles errors with custom status", async () => {
      const handler: ServeHandler = async () => {
        throw {
          status: 400,
          body: { error: { type: "BAD_REQUEST", message: "Invalid input" } },
        };
      };

      const listener = createNodeHandler(handler);
      const response = new MockResponse();

      await listener(createMockRequest({}) as any, response as any);

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.body);
      expect(result.error.type).toBe("BAD_REQUEST");
      expect(result.error.message).toBe("Invalid input");
    });

    it("handles response with custom headers", async () => {
      const handler: ServeHandler = async () => ({
        status: 200,
        headers: {
          "x-custom-header": "custom-value",
          "content-type": "text/plain",
        },
        body: "Custom response",
      });

      const listener = createNodeHandler(handler);
      const response = new MockResponse();

      await listener(createMockRequest({}) as any, response as any);

      expect(response.statusCode).toBe(200);
      expect(response.getHeader("x-custom-header")).toBe("custom-value");
      expect(response.getHeader("content-type")).toBe("text/plain");
      expect(response.body).toBe("Custom response");
    });

    it("handles large request bodies", async () => {
      const largeBody = { data: "x".repeat(10000) };
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { size: JSON.stringify(request.body).length },
      });

      const listener = createNodeHandler(handler);
      const response = new MockResponse();

      await listener(
        createMockRequest({
          body: largeBody,
          headers: { "content-type": "application/json" },
        }) as any,
        response as any
      );

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.size).toBeGreaterThan(10000);
    });
  });
});

describe("startNodeServer", () => {
  it("returns 413 when a request body exceeds the configured limit", async () => {
    const handler: ServeHandler = async () => ({
      status: 200,
      body: { ok: true },
    });
    const started = await startNodeServer(handler, {
      port: 0,
      hostname: "127.0.0.1",
      bodyLimit: 4,
      quiet: true,
    });

    try {
      const response = await postWithNodeHttp(
        `${serverUrl(started.server)}/too-large`,
        JSON.stringify({ data: "too large" }),
        { "content-type": "application/json" },
      );

      expect(response.status).toBe(413);
      expect(JSON.parse(response.body)).toEqual({
        error: {
          type: "PAYLOAD_TOO_LARGE",
          message: "Request body exceeds the configured size limit",
        },
      });
    } finally {
      await started.stop();
    }
  });

  it("returns 504 when the request handler exceeds the timeout", async () => {
    const handler: ServeHandler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        status: 200,
        body: { ok: true },
      };
    };
    const started = await startNodeServer(handler, {
      port: 0,
      hostname: "127.0.0.1",
      requestTimeout: 10,
      quiet: true,
    });

    try {
      const response = await requestWithNodeHttp(`${serverUrl(started.server)}/slow`);
      expect(JSON.parse(response.body)).toEqual({
        error: {
          type: "GATEWAY_TIMEOUT",
          message: "Request timed out after 10ms",
        },
      });
      expect(response.status).toBe(504);
    } finally {
      await started.stop();
    }
  });

  it("stop waits for an in-flight request before resolving", async () => {
    let releaseHandler!: () => void;
    let handlerStarted!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      handlerStarted = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const handler: ServeHandler = async () => {
      handlerStarted();
      await releasePromise;
      return {
        status: 200,
        body: { ok: true },
      };
    };
    const started = await startNodeServer(handler, {
      port: 0,
      hostname: "127.0.0.1",
      gracefulShutdownTimeout: 1000,
      quiet: true,
    });

    const responsePromise = requestWithNodeHttp(`${serverUrl(started.server)}/drain`);
    await startedPromise;

    let stopResolved = false;
    const stopPromise = started.stop().then(() => {
      stopResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(stopResolved).toBe(false);

    releaseHandler();

    const response = await responsePromise;
    await stopPromise;

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(stopResolved).toBe(true);
  });
});
