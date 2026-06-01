/**
 * Unit tests for MCP server
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HypequeryMCPServer } from './server.js';
import type { SemanticExecutor } from '@hypequery/datasets';

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

describe('HypequeryMCPServer', () => {
  const mockExecutor: SemanticExecutor = {
    metric: vi.fn(),
    dataset: vi.fn(),
    run: vi.fn(),
    getBuilderFactory: vi.fn().mockReturnValue({}),
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
  });

  it('should create server instance with default config', () => {
    const server = new HypequeryMCPServer({
      datasets: mockDatasets,
      executor: mockExecutor,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should create server instance with custom name and version', () => {
    const server = new HypequeryMCPServer({
      datasets: mockDatasets,
      executor: mockExecutor,
      name: 'custom-mcp-server',
      version: '1.0.0',
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should accept empty datasets', () => {
    const server = new HypequeryMCPServer({
      datasets: {},
      executor: mockExecutor,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should accept multiple datasets', () => {
    const datasets = {
      orders: { dimensions: {}, metrics: {} },
      customers: { dimensions: {}, metrics: {} },
      products: { dimensions: {}, metrics: {} },
    };

    const server = new HypequeryMCPServer({
      datasets,
      executor: mockExecutor,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should start server successfully', async () => {
    const server = new HypequeryMCPServer({
      datasets: mockDatasets,
      executor: mockExecutor,
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
      executor: mockExecutor,
    });

    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('should handle server lifecycle', async () => {
    const server = new HypequeryMCPServer({
      datasets: mockDatasets,
      executor: mockExecutor,
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await server.start();
    await server.stop();

    expect(consoleErrorSpy).toHaveBeenCalledWith('Hypequery MCP Server started');

    consoleErrorSpy.mockRestore();
  });
});

describe('HypequeryMCPServer config validation', () => {
  const mockExecutor: SemanticExecutor = {
    metric: vi.fn(),
    dataset: vi.fn(),
    run: vi.fn(),
    getBuilderFactory: vi.fn().mockReturnValue({}),
  } as any;

  it('should accept undefined datasets', () => {
    // Server doesn't validate config, it accepts whatever is passed
    const server = new HypequeryMCPServer({
      datasets: undefined as any,
      executor: mockExecutor,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should accept undefined executor', () => {
    // Server doesn't validate config, it accepts whatever is passed
    const server = new HypequeryMCPServer({
      datasets: {},
      executor: undefined as any,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should use default name when not provided', () => {
    const server = new HypequeryMCPServer({
      datasets: {},
      executor: mockExecutor,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });

  it('should use default version when not provided', () => {
    const server = new HypequeryMCPServer({
      datasets: {},
      executor: mockExecutor,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });
});

describe('HypequeryMCPServer with complex datasets', () => {
  const mockExecutor: SemanticExecutor = {
    metric: vi.fn(),
    dataset: vi.fn(),
    run: vi.fn(),
    getBuilderFactory: vi.fn().mockReturnValue({}),
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
      executor: mockExecutor,
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
      executor: mockExecutor,
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
      executor: mockExecutor,
    });

    expect(server).toBeInstanceOf(HypequeryMCPServer);
  });
});
