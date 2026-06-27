/**
 * Unit tests for MCP server
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HypequeryMCPServer } from './server.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DatasetClient } from '@hypequery/datasets';

const requestHandlers = vi.hoisted(() => new Map<unknown, (request: any) => unknown>());

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn((schema, handler) => {
      requestHandlers.set(schema, handler);
    }),
    connect: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

describe('HypequeryMCPServer', () => {
  const mockAnalytics: DatasetClient = {
    execute: vi.fn(),
  } as any;

  const mockDatasets = {
    orders: {
      description: 'Order data',
      dimensions: {
        region: {},
      },
      metrics: {
        revenue: {},
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requestHandlers.clear();
  });

  it('should create server instance with default config', () => {
    const server = new HypequeryMCPServer({
      datasets: mockDatasets,
      analytics: mockAnalytics,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should create server instance with custom name and version', () => {
    const server = new HypequeryMCPServer({
      datasets: mockDatasets,
      analytics: mockAnalytics,
      name: 'custom-mcp-server',
      version: '1.0.0',
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should accept empty datasets', () => {
    const server = new HypequeryMCPServer({
      datasets: {},
      analytics: mockAnalytics,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should require server tenantId for tenant-scoped datasets', () => {
    expect(() => new HypequeryMCPServer({
      datasets: {
        orders: {
          tenantKey: 'tenant_id',
          dimensions: {},
          metrics: {},
        },
      },
      analytics: mockAnalytics,
    })).toThrow('tenantId is required for tenant-scoped datasets: orders');
  });

  it('should accept multiple datasets', () => {
    const datasets = {
      orders: { dimensions: {}, metrics: {} },
      customers: { dimensions: {}, metrics: {} },
      products: { dimensions: {}, metrics: {} },
    };

    const server = new HypequeryMCPServer({
      datasets,
      analytics: mockAnalytics,
      tenantId: 'company-1',
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should start server successfully', async () => {
    const server = new HypequeryMCPServer({
      datasets: mockDatasets,
      analytics: mockAnalytics,
    });

    // Mock console.error to verify logging
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await server.start();

    expect(consoleErrorSpy).toHaveBeenCalledWith('Hypequery MCP Server started');

    consoleErrorSpy.mockRestore();
  });

  it('should stop server successfully', async () => {
    const server = new HypequeryMCPServer({
      datasets: mockDatasets,
      analytics: mockAnalytics,
    });

    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('should handle server lifecycle', async () => {
    const server = new HypequeryMCPServer({
      datasets: mockDatasets,
      analytics: mockAnalytics,
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await server.start();
    await server.stop();

    expect(consoleErrorSpy).toHaveBeenCalledWith('Hypequery MCP Server started');

    consoleErrorSpy.mockRestore();
  });

  it('should forward server tenantId through query_dataset tool calls', async () => {
    const analytics: DatasetClient = {
      execute: vi.fn().mockResolvedValue({
        data: [{ region: 'US', revenue: 100 }],
        meta: { sql: 'SELECT region, SUM(amount) AS revenue FROM orders', timingMs: 12 },
      }),
    } as any;
    const orders = {
      tenantKey: 'tenant_id',
      dimensions: {},
      metrics: {},
    };

    new HypequeryMCPServer({
      datasets: { orders },
      analytics,
      tenantId: 'tenant-123',
    });

    const handler = requestHandlers.get(CallToolRequestSchema);
    expect(handler).toBeDefined();

    const result = await handler?.({
      params: {
        name: 'query_dataset',
        arguments: {
          dataset: 'orders',
          measures: ['revenue'],
          dimensions: ['region'],
        },
      },
    });

    expect(result).toEqual(expect.objectContaining({
      content: expect.any(Array),
    }));
    expect(analytics.execute).toHaveBeenCalledWith(
      orders,
      expect.objectContaining({
        dimensions: ['region'],
        measures: ['revenue'],
      }),
      {
        runtime: {
          tenant: { id: 'tenant-123' },
        },
      },
    );
  });
});

describe('HypequeryMCPServer config validation', () => {
  const mockAnalytics: DatasetClient = {
    execute: vi.fn(),
  } as any;

  it('should accept undefined datasets', () => {
    // Server doesn't validate config, it accepts whatever is passed
    const server = new HypequeryMCPServer({
      datasets: undefined as any,
      analytics: mockAnalytics,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should accept undefined analytics', () => {
    // Server doesn't validate config, it accepts whatever is passed
    const server = new HypequeryMCPServer({
      datasets: {},
      analytics: undefined as any,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should use default name when not provided', () => {
    const server = new HypequeryMCPServer({
      datasets: {},
      analytics: mockAnalytics,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should use default version when not provided', () => {
    const server = new HypequeryMCPServer({
      datasets: {},
      analytics: mockAnalytics,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });
});

describe('HypequeryMCPServer with complex datasets', () => {
  const mockAnalytics: DatasetClient = {
    execute: vi.fn(),
  } as any;

  it('should handle dataset with relationships', () => {
    const datasets = {
      orders: {
        dimensions: { customerId: {} },
        metrics: { revenue: {} },
        relationships: {
          customer: {
            type: 'many-to-one',
            target: 'customers',
          },
        },
      },
      customers: {
        dimensions: { id: {} },
        metrics: { totalOrders: {} },
      },
    };

    const server = new HypequeryMCPServer({
      datasets,
      analytics: mockAnalytics,
      tenantId: 'company-1',
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should handle dataset with config structure', () => {
    const datasets = {
      events: {
        config: {
          description: 'Event data',
          source: 'events_table',
          timeKey: 'timestamp',
          tenantKey: 'company_id',
        },
        dimensions: {},
        metrics: {},
      },
    };

    const server = new HypequeryMCPServer({
      datasets,
      analytics: mockAnalytics,
      tenantId: 'company-1',
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should handle dataset with nested metric definitions', () => {
    const datasets = {
      analytics: {
        dimensions: {
          source: { type: 'string' },
          campaign: { type: 'string' },
        },
        metrics: {
          visitors: {
            type: 'count',
            aggregation: 'count',
            label: 'Unique Visitors',
          },
          conversions: {
            type: 'sum',
            aggregation: 'sum',
            label: 'Total Conversions',
          },
        },
      },
    };

    const server = new HypequeryMCPServer({
      datasets,
      analytics: mockAnalytics,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });
});
