import { describe, expect, it, vi } from "vitest";

const startNodeServerMock = vi.fn(async () => ({
  server: {
    address: () => ({ address: "127.0.0.1", port: 5555 }),
  },
  stop: vi.fn(async () => undefined),
}));

vi.mock("./adapters/node", () => ({
  startNodeServer: startNodeServerMock,
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
  it("starts a dev server using the Node adapter", async () => {
    const devServer = await serveDev(api, { port: 1234, quiet: true });
    expect(startNodeServerMock).toHaveBeenCalledWith(api.handler, {
      hostname: "localhost",
      port: 1234,
      quiet: true,
    });
    await devServer.stop();
    expect(devServer.stop).toHaveBeenCalled();
  });
});
