import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTenantScope, warnTenantMisconfiguration } from "./tenant.js";

describe("Multi-Tenant Isolation", () => {
  describe("createTenantScope", () => {
    // Mock query builder
    function createMockQueryBuilder() {
      const appliedFilters: Array<{ column: string; op: string; value: any }> = [];

      return {
        where: vi.fn((column: string, op: string, value: any) => {
          appliedFilters.push({ column, op, value });
          return mockQuery;
        }),
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        _filters: appliedFilters, // For test inspection
      };
    }

    let mockQuery: ReturnType<typeof createMockQueryBuilder>;

    beforeEach(() => {
      mockQuery = createMockQueryBuilder();
    });

    describe("Returns original db when tenantId is absent", () => {
      it("returns original db when tenantId is null", () => {
        const mockDb = {
          table: vi.fn(() => mockQuery),
          someOtherMethod: vi.fn(),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: null,
          column: "tenant_id",
        });

        expect(scoped).toBe(mockDb);
      });

      it("returns original db when tenantId is undefined", () => {
        const mockDb = {
          table: vi.fn(() => mockQuery),
          someOtherMethod: vi.fn(),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: undefined,
          column: "tenant_id",
        });

        expect(scoped).toBe(mockDb);
      });

      it("returns original db when tenantId is empty string", () => {
        const mockDb = {
          table: vi.fn(() => mockQuery),
          someOtherMethod: vi.fn(),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "",
          column: "tenant_id",
        });

        expect(scoped).toBe(mockDb);
      });
    });

    describe("Applies WHERE clause when tenantId is valid", () => {
      it("applies WHERE clause with correct column and tenantId", () => {
        const mockDb = {
          table: vi.fn(() => mockQuery),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "org-123",
          column: "organization_id",
        });

        const result = scoped.table("users");

        expect(mockDb.table).toHaveBeenCalledWith("users");
        expect(mockQuery.where).toHaveBeenCalledWith("organization_id", "=", "org-123");
        expect(mockQuery._filters).toEqual([
          { column: "organization_id", op: "=", value: "org-123" },
        ]);
      });

      it("uses specified column name", () => {
        const mockDb = {
          table: vi.fn(() => mockQuery),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "tenant-456",
          column: "custom_tenant_column",
        });

        scoped.table("products");

        expect(mockQuery.where).toHaveBeenCalledWith("custom_tenant_column", "=", "tenant-456");
      });

      it("preserves query builder methods after applying filter", () => {
        const mockDb = {
          table: vi.fn(() => mockQuery),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "org-789",
          column: "org_id",
        });

        const query = scoped.table("orders");

        // Query should still have all its methods
        expect(query.select).toBeDefined();
        expect(query.insert).toBeDefined();
        expect(query.update).toBeDefined();
        expect(query.delete).toBeDefined();
      });

      it("allows chaining after tenant filter", () => {
        const chainableMockQuery = {
          where: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
        };

        const mockDb = {
          table: vi.fn(() => chainableMockQuery),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "org-999",
          column: "tenant_id",
        });

        const query = scoped
          .table("posts")
          .select("*")
          .orderBy("created_at")
          .limit(10);

        expect(chainableMockQuery.where).toHaveBeenCalledWith("tenant_id", "=", "org-999");
        expect(chainableMockQuery.select).toHaveBeenCalledWith("*");
        expect(chainableMockQuery.orderBy).toHaveBeenCalledWith("created_at");
        expect(chainableMockQuery.limit).toHaveBeenCalledWith(10);
      });
    });

    describe("Handles queries without .where() method", () => {
      it("returns query as-is when where() method is missing", () => {
        const queryWithoutWhere = {
          select: vi.fn(),
          insert: vi.fn(),
          // No where() method
        };

        const mockDb = {
          table: vi.fn(() => queryWithoutWhere),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "org-111",
          column: "tenant_id",
        });

        const result = scoped.table("special_table");

        expect(result).toBe(queryWithoutWhere);
        expect(mockDb.table).toHaveBeenCalledWith("special_table");
      });

      it("returns query as-is when query is null", () => {
        const mockDb = {
          table: vi.fn(() => null),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "org-222",
          column: "tenant_id",
        });

        const result = scoped.table("null_table");

        expect(result).toBeNull();
        expect(mockDb.table).toHaveBeenCalledWith("null_table");
      });

      it("returns query as-is when query is undefined", () => {
        const mockDb = {
          table: vi.fn(() => undefined),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "org-333",
          column: "tenant_id",
        });

        const result = scoped.table("undefined_table");

        expect(result).toBeUndefined();
        expect(mockDb.table).toHaveBeenCalledWith("undefined_table");
      });

      it("returns query as-is when where is not a function", () => {
        const queryWithInvalidWhere = {
          where: "not a function",
          select: vi.fn(),
        };

        const mockDb = {
          table: vi.fn(() => queryWithInvalidWhere),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "org-444",
          column: "tenant_id",
        });

        const result = scoped.table("invalid_where_table");

        expect(result).toBe(queryWithInvalidWhere);
      });
    });

    describe("Preserves other db methods", () => {
      it("preserves all other db properties and methods", () => {
        const mockDb = {
          table: vi.fn(() => mockQuery),
          raw: vi.fn(),
          transaction: vi.fn(),
          close: vi.fn(),
          customMethod: vi.fn(),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "org-555",
          column: "tenant_id",
        });

        expect(scoped.raw).toBe(mockDb.raw);
        expect(scoped.transaction).toBe(mockDb.transaction);
        expect(scoped.close).toBe(mockDb.close);
        expect(scoped.customMethod).toBe(mockDb.customMethod);
      });
    });

    describe("Tenant isolation verification", () => {
      it("ensures different tenants get different scopes", () => {
        // Create separate mocks for each table call
        const mockQuery1 = createMockQueryBuilder();
        const mockQuery2 = createMockQueryBuilder();

        let callCount = 0;
        const mockDb = {
          table: vi.fn(() => {
            callCount++;
            return callCount === 1 ? mockQuery1 : mockQuery2;
          }),
        };

        const scope1 = createTenantScope(mockDb, {
          tenantId: "tenant-1",
          column: "tenant_id",
        });

        const scope2 = createTenantScope(mockDb, {
          tenantId: "tenant-2",
          column: "tenant_id",
        });

        scope1.table("users");
        scope2.table("users");

        // Both should call where, but with different tenant IDs
        expect(mockQuery1.where).toHaveBeenCalledWith("tenant_id", "=", "tenant-1");
        expect(mockQuery2.where).toHaveBeenCalledWith("tenant_id", "=", "tenant-2");
      });

      it("isolates queries to specific tenant", () => {
        const mockQuery = createMockQueryBuilder();
        const mockDb = {
          table: vi.fn(() => mockQuery),
        };

        const scoped = createTenantScope(mockDb, {
          tenantId: "secure-tenant",
          column: "tenant_id",
        });

        scoped.table("sensitive_data");

        // Verify the filter was applied with exact tenant ID
        expect(mockQuery.where).toHaveBeenCalledWith("tenant_id", "=", "secure-tenant");
        expect(mockQuery._filters).toEqual([
          { column: "tenant_id", op: "=", value: "secure-tenant" },
        ]);
      });
    });
  });

  describe("warnTenantMisconfiguration", () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    describe("Warns when config is missing", () => {
      it("warns when hasTenantConfig is false", () => {
        warnTenantMisconfiguration({
          queryKey: "getUsers",
          hasTenantConfig: false,
          hasTenantId: false,
        });

        expect(consoleWarnSpy).toHaveBeenCalledOnce();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[hypequery/serve] Query "getUsers"')
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("has no tenant configuration")
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("may lead to data leaks")
        );
      });

      it("includes query key in warning message", () => {
        warnTenantMisconfiguration({
          queryKey: "sensitiveQuery",
          hasTenantConfig: false,
          hasTenantId: true,
        });

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Query "sensitiveQuery"')
        );
      });
    });

    describe("Warns when using manual mode with tenantId", () => {
      it("warns when mode is manual and hasTenantId is true", () => {
        warnTenantMisconfiguration({
          queryKey: "manualQuery",
          hasTenantConfig: true,
          hasTenantId: true,
          mode: "manual",
        });

        expect(consoleWarnSpy).toHaveBeenCalledOnce();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[hypequery/serve] Query "manualQuery"')
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("uses manual tenant mode")
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Ensure you manually filter")
        );
      });

      it("includes query key in manual mode warning", () => {
        warnTenantMisconfiguration({
          queryKey: "customManualQuery",
          hasTenantConfig: true,
          hasTenantId: true,
          mode: "manual",
        });

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Query "customManualQuery"')
        );
      });
    });

    describe("No warning when properly configured", () => {
      it("does not warn when hasTenantConfig is true and mode is not manual", () => {
        warnTenantMisconfiguration({
          queryKey: "properQuery",
          hasTenantConfig: true,
          hasTenantId: true,
          mode: "auto",
        });

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it("does not warn when hasTenantConfig is true and mode is undefined", () => {
        warnTenantMisconfiguration({
          queryKey: "anotherQuery",
          hasTenantConfig: true,
          hasTenantId: true,
        });

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it("does not warn when manual mode but no tenantId", () => {
        warnTenantMisconfiguration({
          queryKey: "noTenantQuery",
          hasTenantConfig: true,
          hasTenantId: false,
          mode: "manual",
        });

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });
    });

    describe("Warning message content", () => {
      it("includes correct message for missing config", () => {
        warnTenantMisconfiguration({
          queryKey: "testQuery",
          hasTenantConfig: false,
          hasTenantId: false,
        });

        const call = consoleWarnSpy.mock.calls[0][0];
        expect(call).toContain("hypequery/serve");
        expect(call).toContain("testQuery");
        expect(call).toContain("accesses user data");
        expect(call).toContain("no tenant configuration");
        expect(call).toContain("data leaks");
        expect(call).toContain("Add tenant config");
      });

      it("includes correct message for manual mode", () => {
        warnTenantMisconfiguration({
          queryKey: "manualTestQuery",
          hasTenantConfig: true,
          hasTenantId: true,
          mode: "manual",
        });

        const call = consoleWarnSpy.mock.calls[0][0];
        expect(call).toContain("hypequery/serve");
        expect(call).toContain("manualTestQuery");
        expect(call).toContain("manual tenant mode");
        expect(call).toContain("manually filter queries");
        expect(call).toContain("prevent data leaks");
      });
    });
  });
});
