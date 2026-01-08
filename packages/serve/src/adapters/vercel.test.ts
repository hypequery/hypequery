import { describe, expect, it, vi } from "vitest";

import { createVercelEdgeHandler, createVercelNodeHandler } from "./vercel";
import type { ServeHandler } from "../types";

const createHandler = (): ServeHandler => {
  return async () => ({
    status: 200,
    body: { ok: true },
  });
};

describe("vercel adapters", () => {
  it("wraps the fetch handler for edge runtimes", async () => {
    const handler = createVercelEdgeHandler(createHandler());
    const response = await handler(new Request("https://example.com/api"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("wraps the node handler for Vercel serverless functions", async () => {
    const nodeHandler = createVercelNodeHandler(createHandler());
    const mockRes = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader: vi.fn((key: string, value: string) => {
        mockRes.headers[key] = value;
      }),
      hasHeader: vi.fn((key: string) => key in mockRes.headers),
      end: vi.fn(),
    };

    await nodeHandler(
      {
        method: "GET",
        url: "/api",
        headers: {},
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("");
        },
      },
      mockRes
    );

    expect(mockRes.statusCode).toBe(200);
    expect(mockRes.end).toHaveBeenCalled();
  });
});
