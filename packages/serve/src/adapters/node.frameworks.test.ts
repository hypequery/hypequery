import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { initServe } from "../server";
import { createNodeHandler } from "./node";

const buildApi = () => {
  const { query, serve } = initServe({ context: () => ({}) });
  const echo = query({
    method: "POST",
    input: z.object({ n: z.number() }),
    query: async ({ input }) => [{ n: input.n }],
  });
  const ping = query({ query: async () => [{ ok: true }] });
  return serve({ queries: { echo, ping } });
};

const api = buildApi();
const echoPath = api.manifest().echo.path;
const pingPath = api.manifest().ping.path;

const servers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()));
});

const listen = async (app: Parameters<typeof createServer>[1]) => {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const listenFastify = async (app: FastifyInstance) => {
  await app.listen({ port: 0, host: "127.0.0.1" });
  servers.push(() => app.close());
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
};

const postEcho = (base: string, body: unknown = { n: 7 }) =>
  fetch(`${base}${echoPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("createNodeHandler with Express 5", () => {
  it("routes requests when mounted with app.use and a path prefix", async () => {
    const app = express();
    app.use("/api/analytics", createNodeHandler(api.handler));
    const base = await listen(app);

    const ping = await fetch(`${base}${pingPath}`);
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual([{ ok: true }]);

    const echo = await postEcho(base);
    expect(echo.status).toBe(200);
    expect(await echo.json()).toEqual([{ n: 7 }]);
  });

  it("uses the body parsed by express.json() registered first", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/analytics", createNodeHandler(api.handler));
    const base = await listen(app);

    const response = await postEcho(base, { n: 42 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ n: 42 }]);
  });

  it("parses a body left as text by express.text()", async () => {
    const app = express();
    app.use(express.text({ type: "*/*" }));
    app.all("/api/analytics/{*path}", createNodeHandler(api.handler));
    const base = await listen(app);

    const response = await postEcho(base, { n: 3 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ n: 3 }]);
  });

  it("parses a chunked body left as text by express.text()", async () => {
    const app = express();
    app.use(express.text({ type: "*/*" }));
    app.all("/api/analytics/{*path}", createNodeHandler(api.handler));
    const base = await listen(app);

    // A streamed body is sent chunked, with no content-length.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"n":'));
        controller.enqueue(new TextEncoder().encode("4}"));
        controller.close();
      },
    });
    const response = await fetch(`${base}${echoPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ n: 4 }]);
  });

  it("keeps a chunked JSON string decoded by express.json({ strict: false }) a string", async () => {
    const { query, serve } = initServe({ context: () => ({}) });
    const label = query({
      method: "POST",
      input: z.string(),
      query: async ({ input }) => [{ label: input }],
    });
    const stringApi = serve({ queries: { label } });
    const app = express();
    app.use(express.json({ strict: false }));
    app.use("/api/analytics", createNodeHandler(stringApi.handler));
    const base = await listen(app);

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('"12'));
        controller.enqueue(new TextEncoder().encode('3"'));
        controller.close();
      },
    });
    const response = await fetch(`${base}${stringApi.manifest().label.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ label: "123" }]);
  });

  it("keeps a JSON string decoded by express.json({ strict: false }) within the body limit", async () => {
    const app = express();
    app.use(express.json({ strict: false }));
    app.use(
      "/api/analytics",
      createNodeHandler(api.handler, { bodyLimit: 10 }),
    );
    const base = await listen(app);

    const response = await postEcho(base, JSON.stringify("x".repeat(20)));
    expect(response.status).toBe(413);
  });

  it("applies the body limit to a raw body left by express.raw()", async () => {
    const app = express();
    app.use(express.raw({ type: "*/*" }));
    app.use(
      "/api/analytics",
      createNodeHandler(api.handler, { bodyLimit: 10 }),
    );
    const base = await listen(app);

    const response = await postEcho(base, { n: 1234567890 });
    expect(response.status).toBe(413);
  });

  it("still validates a body parsed upstream", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/analytics", createNodeHandler(api.handler));
    const base = await listen(app);

    const response = await postEcho(base, { n: "nope" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.type).toBe("VALIDATION_ERROR");
  });
});

describe("createNodeHandler with Fastify 5", () => {
  it("uses Fastify's parsed body when exposed on request.raw", async () => {
    const handler = createNodeHandler(api.handler);
    const app = Fastify();
    app.all("/api/analytics/*", async (request, reply) => {
      reply.hijack();
      (request.raw as typeof request.raw & { body?: unknown }).body =
        request.body;
      await handler(request.raw, reply.raw);
    });
    const base = await listenFastify(app);

    const response = await postEcho(base, { n: 9 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ n: 9 }]);
  });

  it("reads the stream itself when hijacked from an onRequest hook", async () => {
    const handler = createNodeHandler(api.handler);
    const app = Fastify();
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.startsWith("/api/analytics/")) return;
      reply.hijack();
      await handler(request.raw, reply.raw);
    });
    const base = await listenFastify(app);

    const response = await postEcho(base, { n: 11 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ n: 11 }]);
  });

  it("explains a consumed body instead of returning a validation error", async () => {
    const handler = createNodeHandler(api.handler);
    const app = Fastify();
    app.all("/api/analytics/*", async (request, reply) => {
      reply.hijack();
      await handler(request.raw, reply.raw);
    });
    const base = await listenFastify(app);

    const response = await postEcho(base);
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error.type).toBe("INTERNAL_SERVER_ERROR");
    expect(payload.error.message).toContain("request.raw.body = request.body");
  });
});
