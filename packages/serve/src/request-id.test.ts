import { describe, expect, it } from "vitest";

import { defineServe } from "./server";
import type { ServeRequest } from "./types";
import {
  MAX_CORRELATION_ID_BYTES,
  validateCorrelationId,
} from "./utils";

const BASE_PATH = "/api/analytics";

const createRequest = (overrides: Partial<ServeRequest> = {}): ServeRequest => ({
  method: "GET",
  headers: {},
  query: {},
  ...overrides,
  path:
    overrides.path && overrides.path.startsWith(BASE_PATH)
      ? overrides.path
      : `${BASE_PATH}${overrides.path ?? "/metrics"}`,
});

const buildApi = () => {
  const api = defineServe({
    queries: {
      metrics: { query: async () => ({ ok: true }) },
    },
  });
  api.route("/metrics", api.queries.metrics);
  return api;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("validateCorrelationId", () => {
  it("accepts and trims a safe value", () => {
    expect(validateCorrelationId("  trace-abc_123  ")).toBe("trace-abc_123");
  });

  it("rejects absent, empty, or non-string values", () => {
    expect(validateCorrelationId(undefined)).toBeUndefined();
    expect(validateCorrelationId("")).toBeUndefined();
    expect(validateCorrelationId("   ")).toBeUndefined();
    expect(validateCorrelationId(42 as unknown as string)).toBeUndefined();
  });

  it("rejects control characters (newline / null / DEL / C1)", () => {
    expect(validateCorrelationId("a\nb")).toBeUndefined();
    expect(validateCorrelationId("a\u0000b")).toBeUndefined();
    expect(validateCorrelationId("a\u007Fb")).toBeUndefined();
    expect(validateCorrelationId("a\u0085b")).toBeUndefined();
  });

  it("rejects an oversized value but accepts one at the byte bound", () => {
    expect(validateCorrelationId("x".repeat(MAX_CORRELATION_ID_BYTES))).toHaveLength(
      MAX_CORRELATION_ID_BYTES,
    );
    expect(validateCorrelationId("x".repeat(MAX_CORRELATION_ID_BYTES + 1))).toBeUndefined();
  });
});

describe("request-id authority in the pipeline", () => {
  it("generates a server-side authoritative id and ignores a client x-request-id", async () => {
    const api = buildApi();
    const clientValue = "client-supplied-id";
    const response = await api.handler(
      createRequest({ headers: { "x-request-id": clientValue } }),
    );

    // Authoritative id is server-generated, never the client's value.
    expect(response.headers?.["x-request-id"]).not.toBe(clientValue);
    expect(response.headers?.["x-request-id"]).toMatch(UUID);
    // The client value survives only as a separately-named, validated correlation id.
    expect(response.headers?.["x-correlation-id"]).toBe(clientValue);
  });

  it("drops a malicious correlation id instead of reflecting it", async () => {
    const api = buildApi();
    const response = await api.handler(
      createRequest({ headers: { "x-request-id": "evil\r\nSet-Cookie: x=1" } }),
    );

    expect(response.headers?.["x-correlation-id"]).toBeUndefined();
    // Authoritative id remains clean and server-generated.
    expect(response.headers?.["x-request-id"]).toMatch(UUID);
  });

  it("omits the correlation header when no external id is supplied", async () => {
    const api = buildApi();
    const response = await api.handler(createRequest());

    expect(response.headers?.["x-correlation-id"]).toBeUndefined();
    expect(response.headers?.["x-request-id"]).toMatch(UUID);
  });

  it("falls back to x-trace-id for the correlation id", async () => {
    const api = buildApi();
    const response = await api.handler(
      createRequest({ headers: { "x-trace-id": "trace-xyz" } }),
    );

    expect(response.headers?.["x-correlation-id"]).toBe("trace-xyz");
  });

  it("attaches the authoritative id on a 404", async () => {
    const api = buildApi();
    const response = await api.handler(
      createRequest({ path: "/api/analytics/missing", headers: { "x-request-id": "c-1" } }),
    );

    expect(response.status).toBe(404);
    expect(response.headers?.["x-request-id"]).toMatch(UUID);
    expect(response.headers?.["x-correlation-id"]).toBe("c-1");
  });
});
