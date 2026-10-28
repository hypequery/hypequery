import type { IncomingMessage } from "http";
import { describe, expect, it } from "vitest";

import {
  declaresRequestBody,
  isNodeBodyConsumed,
  readPreParsedBody,
  resolveNodeRequestUrl,
} from "./node-request";

const mockRequest = (fields: Record<string, unknown>) =>
  ({ headers: {}, readableEnded: false, ...fields }) as unknown as IncomingMessage;

describe("resolveNodeRequestUrl", () => {
  it("prefers originalUrl over a prefix-stripped url", () => {
    const req = mockRequest({ url: "/queries/a?x=1", originalUrl: "/api/analytics/queries/a?x=1" });
    expect(resolveNodeRequestUrl(req)).toBe("/api/analytics/queries/a?x=1");
  });

  it("falls back to url, then /", () => {
    expect(resolveNodeRequestUrl(mockRequest({ url: "/a" }))).toBe("/a");
    expect(resolveNodeRequestUrl(mockRequest({ url: "/a", originalUrl: "" }))).toBe("/a");
    expect(resolveNodeRequestUrl(mockRequest({}))).toBe("/");
  });
});

describe("isNodeBodyConsumed", () => {
  it("detects an ended stream or body-parser's _body flag", () => {
    expect(isNodeBodyConsumed(mockRequest({}))).toBe(false);
    expect(isNodeBodyConsumed(mockRequest({ readableEnded: true }))).toBe(true);
    expect(isNodeBodyConsumed(mockRequest({ _body: true }))).toBe(true);
  });
});

describe("declaresRequestBody", () => {
  it("reads content-length and transfer-encoding", () => {
    expect(declaresRequestBody(mockRequest({}))).toBe(false);
    expect(declaresRequestBody(mockRequest({ headers: { "content-length": "0" } }))).toBe(false);
    expect(declaresRequestBody(mockRequest({ headers: { "content-length": "12" } }))).toBe(true);
    expect(declaresRequestBody(mockRequest({ headers: { "transfer-encoding": "chunked" } }))).toBe(true);
  });
});

describe("readPreParsedBody", () => {
  it("classifies what an upstream parser left on req.body", () => {
    expect(readPreParsedBody(mockRequest({}))).toEqual({ kind: "none" });
    expect(readPreParsedBody(mockRequest({ body: { n: 1 } }))).toEqual({ kind: "parsed", value: { n: 1 } });
    expect(readPreParsedBody(mockRequest({ body: "hi" }))).toEqual({ kind: "raw", buffer: Buffer.from("hi") });
    const buffer = Buffer.from("raw");
    expect(readPreParsedBody(mockRequest({ body: buffer }))).toEqual({ kind: "raw", buffer });
  });
});
