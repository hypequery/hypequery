import { describe, expect, it } from "vitest";

import { createFetchHandler } from "./fetch";
import type { ServeHandler } from "../types";

const createHandler = (): ServeHandler => {
  return async (request) => ({
    status: 200,
    headers: {
      "x-test": "ok",
    },
    body: {
      method: request.method,
      path: request.path,
      query: request.query,
      body: request.body,
    },
  });
};

describe("createFetchHandler", () => {
  it("adapts Fetch API requests to the serve handler", async () => {
    const fetchHandler = createFetchHandler(createHandler());
    const request = new Request("https://example.com/metrics?foo=bar&foo=baz", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ hello: "world" }),
    });

    const response = await fetchHandler(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-test")).toBe("ok");
    expect(json).toEqual({
      method: "POST",
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

      const fetchHandler = createFetchHandler(handler);
      const request = new Request("https://example.com/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{invalid json",
      });

      const response = await fetchHandler(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      // Malformed JSON should result in undefined body
      expect(json.receivedBody).toBeUndefined();
    });

    it("handles missing Content-Type header (GET request)", async () => {
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { hasBody: request.body !== undefined },
      });

      const fetchHandler = createFetchHandler(handler);
      const request = new Request("https://example.com/test", {
        method: "GET",
      });

      const response = await fetchHandler(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.hasBody).toBe(false);
    });

    it("handles request with default content-type", async () => {
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { receivedBody: request.body },
      });

      const fetchHandler = createFetchHandler(handler);
      // Request constructor auto-sets content-type to "text/plain" for string bodies
      const request = new Request("https://example.com/test", {
        method: "POST",
        body: "some text",
      });

      const response = await fetchHandler(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      // With text/plain content-type, body is parsed as text
      expect(json.receivedBody).toBe("some text");
    });

    it("handles empty request body", async () => {
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { hasBody: request.body !== undefined },
      });

      const fetchHandler = createFetchHandler(handler);
      const request = new Request("https://example.com/test", {
        method: "GET",
      });

      const response = await fetchHandler(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.hasBody).toBe(false);
    });

    it("handles text content types", async () => {
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { receivedBody: request.body },
      });

      const fetchHandler = createFetchHandler(handler);
      const request = new Request("https://example.com/test", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "plain text content",
      });

      const response = await fetchHandler(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.receivedBody).toBe("plain text content");
    });

    it("handles binary content types", async () => {
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { hasBody: request.body !== undefined },
      });

      const fetchHandler = createFetchHandler(handler);
      const buffer = new Uint8Array([1, 2, 3, 4, 5]);
      const request = new Request("https://example.com/test", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: buffer,
      });

      const response = await fetchHandler(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.hasBody).toBe(true);
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

      const fetchHandler = createFetchHandler(handler);
      const request = new Request("https://example.com/test");

      const response = await fetchHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("x-custom-header")).toBe("custom-value");
      expect(response.headers.get("content-type")).toBe("text/plain");
      expect(await response.text()).toBe("Custom response");
    });

    it("handles response with JSON body", async () => {
      const handler: ServeHandler = async () => ({
        status: 200,
        body: { data: "test", count: 42 },
      });

      const fetchHandler = createFetchHandler(handler);
      const request = new Request("https://example.com/test");

      const response = await fetchHandler(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json).toEqual({ data: "test", count: 42 });
    });

    it("handles response with null body", async () => {
      const handler: ServeHandler = async () => ({
        status: 200,
        body: null,
      });

      const fetchHandler = createFetchHandler(handler);
      const request = new Request("https://example.com/test");

      const response = await fetchHandler(request);
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).toBe("null");
    });

    it("handles large request bodies", async () => {
      const largeData = { data: "x".repeat(10000) };
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { size: JSON.stringify(request.body).length },
      });

      const fetchHandler = createFetchHandler(handler);
      const request = new Request("https://example.com/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(largeData),
      });

      const response = await fetchHandler(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.size).toBeGreaterThan(10000);
    });

    it("handles various HTTP methods", async () => {
      const handler: ServeHandler = async (request) => ({
        status: 200,
        body: { method: request.method },
      });

      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

      for (const method of methods) {
        const fetchHandler = createFetchHandler(handler);
        const request = new Request("https://example.com/test", { method });

        const response = await fetchHandler(request);
        const json = await response.json();

        expect(json.method).toBe(method);
      }
    });
  });
});
