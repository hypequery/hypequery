import { describe, expect, it } from "vitest";
import { z as zod4 } from "zod";
import { z as zod3 } from "zod/v3";

import { defineServe } from "./server";
import type { ServeRequest } from "./types";

// Serve depends on Zod 4 but accepts the caller's own Zod 3 or Zod 4 schemas.
describe.each([["zod 3", zod3], ["zod 4", zod4]] as const)("%s endpoint schemas", (_major, zodModule) => {
  const z = zodModule as any;

  const buildApi = (received: unknown[]) => {
    const api = defineServe({
      basePath: "/api",
      queries: {
        orders: {
          inputSchema: z.object({
            limit: z.number().int().min(1),
            status: z.enum(["open", "closed"]).optional(),
          }),
          outputSchema: z.object({ total: z.number() }),
          query: async ({ input }: { input: unknown }) => {
            received.push(input);
            return { total: 3 };
          },
        },
      },
    });
    api.route("/orders", api.queries.orders);
    return api;
  };

  const get = (query: Record<string, string>): ServeRequest => ({
    method: "GET",
    path: "/api/orders",
    headers: {},
    query,
  });

  it("coerces query strings and validates with the caller's schema", async () => {
    const received: unknown[] = [];
    const api = buildApi(received);

    const response = await api.handler(get({ limit: "5", status: "open" }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ total: 3 });
    expect(received).toEqual([{ limit: 5, status: "open" }]);
  });

  it("returns the schema's issues on invalid input", async () => {
    const api = buildApi([]);

    const response = await api.handler(get({ limit: "abc" }));

    expect(response.status).toBe(400);
    const body = response.body as { error: { type: string; details: { issues: Array<{ path: unknown[] }> } } };
    expect(body.error.type).toBe("VALIDATION_ERROR");
    expect(body.error.details.issues[0].path).toEqual(["limit"]);
  });

  it("describes the schema in the OpenAPI document", async () => {
    const api = buildApi([]);

    const response = await api.handler({ method: "GET", path: "/api/openapi.json", headers: {}, query: {} });

    const operation = (response.body as any).paths["/api/orders"].get;
    expect(operation.parameters).toEqual([
      expect.objectContaining({ name: "limit", in: "query", required: true, schema: expect.objectContaining({ type: "integer", minimum: 1 }) }),
      expect.objectContaining({ name: "status", in: "query", required: false, schema: expect.objectContaining({ enum: ["open", "closed"] }) }),
    ]);
    expect(operation.responses[200].content["application/json"].schema).toMatchObject({
      type: "object",
      properties: { total: { type: "number" } },
      required: ["total"],
    });
  });
});
