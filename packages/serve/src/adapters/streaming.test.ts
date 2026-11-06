import { request as httpRequest } from "http";
import type { AddressInfo } from "net";
import { describe, expect, it, vi } from "vitest";

import { startNodeServer } from "./node";
import { createFetchHandler } from "./fetch";
import { streamBody } from "../utils/stream-body";
import type { ServeHandler } from "../types";

const encoder = new TextEncoder();

/** A stream of *count* lines, recording cancellation. */
function lines(count: number, options: { failAt?: number; delayMs?: number } = {}) {
  const state = { cancelled: false, sent: 0 };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
      if (options.failAt !== undefined && state.sent === options.failAt) {
        controller.error(new Error("query failed"));
        return;
      }
      if (state.sent === count) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`${JSON.stringify({ n: state.sent })}\n`));
      state.sent += 1;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

function get(url: string, onFirstChunk?: (destroy: () => void) => void) {
  return new Promise<{ status: number; type?: string; body: string; aborted: boolean }>((resolve) => {
    const req = httpRequest(url, (res) => {
      let body = "";
      let first = true;
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
        if (first && onFirstChunk) onFirstChunk(() => req.destroy());
        first = false;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: res.headers["content-type"], body, aborted: false }));
      res.on("error", () => resolve({ status: res.statusCode ?? 0, body, aborted: true }));
      res.on("aborted", () => resolve({ status: res.statusCode ?? 0, body, aborted: true }));
    });
    req.on("error", () => resolve({ status: 0, body: "", aborted: true }));
    req.end();
  });
}

async function serve(handler: ServeHandler, requestTimeout?: number) {
  const started = await startNodeServer(handler, { port: 0, hostname: "127.0.0.1", quiet: true, requestTimeout });
  const { port } = started.server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/stream`, stop: started.stop };
}

describe("streamed response bodies", () => {
  it("writes every chunk with the stream's content type", async () => {
    const { stream, state } = lines(500);
    const server = await serve(async () => ({ status: 200, headers: { "cache-control": "no-store" }, body: streamBody(stream, "application/x-ndjson") }));
    try {
      const response = await get(server.url);
      expect(response.status).toBe(200);
      expect(response.type).toBe("application/x-ndjson");
      expect(response.body.trimEnd().split("\n")).toHaveLength(500);
      expect(state.cancelled).toBe(false);
    } finally {
      await server.stop();
    }
  });

  it("cancels the stream when the client disconnects", async () => {
    const { stream, state } = lines(100_000, { delayMs: 1 });
    const server = await serve(async () => ({ status: 200, body: streamBody(stream, "application/x-ndjson") }));
    try {
      await get(server.url, destroy => destroy());
      await vi.waitFor(() => expect(state.cancelled).toBe(true));
      expect(state.sent).toBeLessThan(100_000);
    } finally {
      await server.stop();
    }
  });

  it("breaks the connection when the stream fails partway", async () => {
    const { stream } = lines(10, { failAt: 3 });
    const server = await serve(async () => ({ status: 200, body: streamBody(stream, "application/vnd.apache.arrow.stream") }));
    try {
      const response = await get(server.url);
      // Never a clean end: a reader must not mistake a broken stream for a complete one.
      expect(response.aborted).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it("is not limited by the request timeout once the stream has started", async () => {
    const { stream } = lines(20, { delayMs: 10 });
    const server = await serve(async () => ({ status: 200, body: streamBody(stream, "application/x-ndjson") }), 50);
    try {
      const response = await get(server.url);
      expect(response.status).toBe(200);
      expect(response.body.trimEnd().split("\n")).toHaveLength(20);
    } finally {
      await server.stop();
    }
  });

  it("cancels a stream its handler opened after the request timed out", async () => {
    const { stream, state } = lines(5);
    const server = await serve(async () => {
      await new Promise(resolve => setTimeout(resolve, 80));
      return { status: 200, body: streamBody(stream, "application/x-ndjson") };
    }, 20);
    try {
      const response = await get(server.url);
      expect(response.status).toBe(504);
      await vi.waitFor(() => expect(state.cancelled).toBe(true));
    } finally {
      await server.stop();
    }
  });

  it("passes the stream through the fetch adapter", async () => {
    const { stream } = lines(3);
    const handler = createFetchHandler(async () => ({ status: 200, headers: { "x-request-id": "r" }, body: streamBody(stream, "application/x-ndjson") }));
    const response = await handler(new Request("http://localhost/stream", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(response.headers.get("x-request-id")).toBe("r");
    expect((await response.text()).trimEnd().split("\n")).toHaveLength(3);
  });
});
