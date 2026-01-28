import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock createNodeHandler to avoid actual HTTP handling
const createNodeHandlerMock = vi.fn(() => async () => {});

vi.mock("./adapters/node", () => ({
  createNodeHandler: createNodeHandlerMock,
}));

// Mock dev-ui modules to avoid SQLite and filesystem dependencies
vi.mock("./dev-ui/index.js", () => ({
  createStore: vi.fn(async () => ({
    initialize: vi.fn(),
    close: vi.fn(async () => {}),
  })),
  DevQueryLogger: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    shutdown: vi.fn(async () => {}),
  })),
  createDevHandler: vi.fn(() => ({
    handleRequest: vi.fn(async () => false),
    getRouter: vi.fn(() => ({
      getSSEHandler: vi.fn(() => ({
        broadcastQueryEvent: vi.fn(),
      })),
    })),
    shutdown: vi.fn(),
  })),
  isDevUIAvailable: vi.fn(() => false),
}));

const { serveDev } = await import("./dev");
const { defineServe } = await import("./server");

const api = defineServe({
  queries: {
    ping: {
      query: async () => ({ ok: true }),
    },
  },
});

api.route("/ping", api.queries.ping);

describe("serveDev", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a dev server and creates a node handler", async () => {
    const devServer = await serveDev(api, { port: 1234, quiet: true });

    // Verify createNodeHandler was called (either for enhanced or standard handler)
    expect(createNodeHandlerMock).toHaveBeenCalled();

    // Server should be running
    expect(devServer.server).toBeDefined();

    // Stop should work
    await devServer.stop();
  });

  it("includes dev UI components when not disabled", async () => {
    const devServer = await serveDev(api, { port: 1235, quiet: true });

    // Should have store and devHandler
    expect(devServer.store).toBeDefined();
    expect(devServer.queryLogger).toBeDefined();
    expect(devServer.devHandler).toBeDefined();

    await devServer.stop();
  });

  it("excludes dev UI components when disabled", async () => {
    const devServer = await serveDev(api, {
      port: 1236,
      quiet: true,
      disableDevUI: true,
    });

    // Should not have dev UI components
    expect(devServer.store).toBeNull();
    expect(devServer.queryLogger).toBeNull();
    expect(devServer.devHandler).toBeNull();

    await devServer.stop();
  });
});
