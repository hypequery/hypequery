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
});
