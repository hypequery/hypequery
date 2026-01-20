import { Readable } from "stream";
import { describe, expect, it } from "vitest";

import { createNodeHandler } from "./node";
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
