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

  it("keeps a JSON string that express.json({ strict: false }) already decoded", () => {
    // The client sent `"123"` (5 bytes); the parser left the string `123`.
    const decoded = mockRequest({
      body: "123",
      headers: { "content-type": "application/json", "content-length": "5" },
    });
    expect(readPreParsedBody(decoded)).toEqual({ kind: "parsed", value: "123" });

    // express.text({ type: "application/json" }) leaves the raw text, whose
    // length matches what the client declared.
    const rawText = mockRequest({
      body: '{"n":1}',
      headers: { "content-type": "application/json", "content-length": "7" },
    });
    expect(readPreParsedBody(rawText)).toEqual({ kind: "raw", buffer: Buffer.from('{"n":1}') });
  });

  it("treats a string as raw text when its length cannot be compared", () => {
    // Chunked: no content-length, so express.text()'s raw JSON must still be parsed.
    const chunked = mockRequest({
      body: '{"n":1}',
      headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
    });
    expect(readPreParsedBody(chunked)).toEqual({ kind: "raw", buffer: Buffer.from('{"n":1}') });

    // Compressed: content-length counts the gzip bytes, not the inflated text.
    const compressed = mockRequest({
      body: '{"n":1}',
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": "27",
      },
    });
    expect(readPreParsedBody(compressed)).toEqual({ kind: "raw", buffer: Buffer.from('{"n":1}') });
  });
});
