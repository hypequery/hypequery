import { describe, it, expect } from "vitest";
import {
  extractClientConfig,
  defineClientConfig,
  type ApiClientConfig,
} from "./client-config.js";
import type { ServeBuilder } from "./types.js";

describe("Client Config Utilities", () => {
  describe("extractClientConfig", () => {
    describe("Route config priority", () => {
      it("prefers _routeConfig over endpoint.method", () => {
        const api = {
          queries: {
            getUsers: { method: "POST" as const },
            createUser: { method: "GET" as const },
          },
          _routeConfig: {
            getUsers: { method: "GET" as const },
            createUser: { method: "POST" as const },
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        // Should use _routeConfig methods, not queries methods
        expect(config).toEqual({
          getUsers: { method: "GET" },
          createUser: { method: "POST" },
        });
      });

      it("uses all route configs when _routeConfig exists", () => {
        const api = {
          queries: {},
          _routeConfig: {
            query1: { method: "GET" as const },
            query2: { method: "POST" as const },
            query3: { method: "PUT" as const },
            query4: { method: "DELETE" as const },
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        expect(config).toEqual({
          query1: { method: "GET" },
          query2: { method: "POST" },
          query3: { method: "PUT" },
          query4: { method: "DELETE" },
        });
      });
    });

    describe("Fallback to endpoint method", () => {
      it("extracts from queries when no _routeConfig", () => {
        const api = {
          queries: {
            getUsers: { method: "GET" as const },
            createUser: { method: "POST" as const },
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        expect(config).toEqual({
          getUsers: { method: "GET" },
          createUser: { method: "POST" },
        });
      });

      it("extracts all queries when _routeConfig is undefined", () => {
        const api = {
          queries: {
            listItems: { method: "GET" as const },
            createItem: { method: "POST" as const },
            updateItem: { method: "PUT" as const },
            deleteItem: { method: "DELETE" as const },
            patchItem: { method: "PATCH" as const },
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        expect(config).toEqual({
          listItems: { method: "GET" },
          createItem: { method: "POST" },
          updateItem: { method: "PUT" },
          deleteItem: { method: "DELETE" },
          patchItem: { method: "PATCH" },
        });
      });
    });

    describe("Mixed configurations", () => {
      it("handles route config with subset of queries", () => {
        const api = {
          queries: {
            query1: { method: "GET" as const },
            query2: { method: "POST" as const },
            query3: { method: "PUT" as const },
          },
          _routeConfig: {
            // Only override query1 and query2
            query1: { method: "POST" as const },
            query2: { method: "GET" as const },
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        // Should only include queries from _routeConfig
        // (query3 is not included because _routeConfig takes priority)
        expect(config).toEqual({
          query1: { method: "POST" },
          query2: { method: "GET" },
        });
      });

      it("handles route config with additional queries not in queries object", () => {
        const api = {
          queries: {
            query1: { method: "GET" as const },
          },
          _routeConfig: {
            query1: { method: "POST" as const },
            query2: { method: "PUT" as const }, // Not in queries
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        // Should include all from _routeConfig
        expect(config).toEqual({
          query1: { method: "POST" },
          query2: { method: "PUT" },
        });
      });
    });

    describe("Empty configurations", () => {
      it("returns empty object when no queries and no _routeConfig", () => {
        const api = {
          queries: {},
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        expect(config).toEqual({});
      });

      it("returns empty object when _routeConfig is empty", () => {
        const api = {
          queries: {
            query1: { method: "GET" as const },
          },
          _routeConfig: {},
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        expect(config).toEqual({});
      });
    });

    describe("HTTP method extraction", () => {
      it("correctly extracts GET method", () => {
        const api = {
          queries: {
            getData: { method: "GET" as const },
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        expect(config.getData.method).toBe("GET");
      });

      it("correctly extracts POST method", () => {
        const api = {
          queries: {
            createData: { method: "POST" as const },
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        expect(config.createData.method).toBe("POST");
      });

      it("correctly extracts PUT method", () => {
        const api = {
          queries: {
            updateData: { method: "PUT" as const },
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        expect(config.updateData.method).toBe("PUT");
      });

      it("correctly extracts DELETE method", () => {
        const api = {
          queries: {
            removeData: { method: "DELETE" as const },
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        expect(config.removeData.method).toBe("DELETE");
      });

      it("correctly extracts PATCH method", () => {
        const api = {
          queries: {
            patchData: { method: "PATCH" as const },
          },
        } as unknown as ServeBuilder<any, any, any>;

        const config = extractClientConfig(api);

        expect(config.patchData.method).toBe("PATCH");
      });
    });
  });

  describe("defineClientConfig", () => {
    it("returns the same config object", () => {
      const config: ApiClientConfig = {
        hello: { method: "GET" },
        createUser: { method: "POST" },
      };

      const result = defineClientConfig(config);

      expect(result).toBe(config);
      expect(result).toEqual(config);
    });

    it("preserves all properties", () => {
      const config = {
        query1: { method: "GET" as const },
        query2: { method: "POST" as const },
        query3: { method: "PUT" as const },
        query4: { method: "DELETE" as const },
        query5: { method: "PATCH" as const },
      };

      const result = defineClientConfig(config);

      expect(result).toEqual(config);
      expect(Object.keys(result)).toEqual(Object.keys(config));
    });

    it("handles empty config", () => {
      const config = {};

      const result = defineClientConfig(config);

      expect(result).toEqual({});
    });

    it("maintains type safety for method values", () => {
      const config = defineClientConfig({
        test: { method: "GET" as const },
      });

      // Type assertion to verify type safety
      const method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" = config.test.method;
      expect(method).toBe("GET");
    });
  });
});
