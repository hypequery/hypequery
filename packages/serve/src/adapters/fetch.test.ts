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
});
