import { describe, expect, it, vi, afterEach } from "vitest";

import { ServeQueryLogger, type ServeQueryEvent } from "./query-logger";

const sampleEvent: ServeQueryEvent = {
  requestId: "req-1",
  endpointKey: "ping",
  path: "/ping",
  method: "GET",
  status: "completed",
  startTime: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ServeQueryLogger.emit", () => {
  it("delivers events to all listeners", () => {
    const logger = new ServeQueryLogger();
    const a = vi.fn();
    const b = vi.fn();
    logger.on(a);
    logger.on(b);

    logger.emit(sampleEvent);

    expect(a).toHaveBeenCalledWith(sampleEvent);
    expect(b).toHaveBeenCalledWith(sampleEvent);
  });

  it("does not let a throwing listener break others, but surfaces the error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logger = new ServeQueryLogger();
    const boom = vi.fn(() => {
      throw new Error("listener boom");
    });
    const after = vi.fn();
    logger.on(boom);
    logger.on(after);

    expect(() => logger.emit(sampleEvent)).not.toThrow();

    expect(after).toHaveBeenCalledWith(sampleEvent);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("query event listener threw");
  });
});
