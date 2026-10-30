import type { IncomingMessage } from "http";

/**
 * Fields that Node frameworks attach to the incoming request. Express/Connect
 * set `originalUrl` and body parsers (express.json(), body-parser, NestJS's
 * default parser) set `body`; body-parser also sets `_body` once it has read
 * the stream.
 */
type FrameworkRequest = IncomingMessage & {
  originalUrl?: unknown;
  body?: unknown;
  _body?: unknown;
};

/**
 * The URL the client actually requested. Express and Connect strip the mount
 * prefix from `req.url` inside `app.use('/prefix', handler)` but keep the full
 * URL in `req.originalUrl`; routing needs the full path to match `basePath`.
 */
export const resolveNodeRequestUrl = (req: IncomingMessage): string => {
  const { originalUrl } = req as FrameworkRequest;
  if (typeof originalUrl === "string" && originalUrl.length > 0) {
    return originalUrl;
  }
  return req.url ?? "/";
};

/**
 * True when something upstream (a body parser) has already read the request
 * stream, so reading it again would yield nothing.
 */
export const isNodeBodyConsumed = (req: IncomingMessage): boolean =>
  req.readableEnded || (req as FrameworkRequest)._body === true;

/** True when the request headers announce a body. */
export const declaresRequestBody = (req: IncomingMessage): boolean => {
  if (req.headers["transfer-encoding"] !== undefined) return true;
  const length = Number(req.headers["content-length"]);
  return Number.isFinite(length) && length > 0;
};

export type PreParsedBody =
  | { kind: "none" }
  | { kind: "raw"; buffer: Buffer }
  | { kind: "parsed"; value: unknown };

/**
 * True when a string `req.body` is a JSON value that a parser already decoded
 * (`express.json({ strict: false })` turns `"123"` into the string `123`)
 * rather than the raw text of the request. Raw text has exactly the byte
 * length the client declared; a decoded JSON string is at least two bytes
 * shorter because its quotes are gone. Without a declared length to compare
 * (a chunked body) or with a content encoding (the declared length is of the
 * compressed bytes), nothing shows a string was decoded, so it is raw text.
 */
const isDecodedJsonString = (req: IncomingMessage, body: string): boolean => {
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || !contentType.includes("application/json")) {
    return false;
  }
  const encoding = req.headers["content-encoding"];
  if (encoding !== undefined && encoding.trim().toLowerCase() !== "identity") {
    return false;
  }
  const declared = req.headers["content-length"];
  if (declared === undefined || !/^\d+$/.test(declared)) return false;
  return Number(declared) !== Buffer.byteLength(body, "utf8");
};

/**
 * The body an upstream parser left on `req.body`. Strings and Buffers
 * (express.text(), express.raw()) are returned as raw bytes so the adapter can
 * apply its own size limit and content-type parsing; anything else, including
 * a JSON string a JSON parser already decoded, is used as-is.
 */
export const readPreParsedBody = (req: IncomingMessage): PreParsedBody => {
  const { body } = req as FrameworkRequest;
  if (body === undefined) return { kind: "none" };
  if (Buffer.isBuffer(body)) return { kind: "raw", buffer: body };
  if (typeof body === "string" && !isDecodedJsonString(req, body)) {
    return { kind: "raw", buffer: Buffer.from(body, "utf8") };
  }
  return { kind: "parsed", value: body };
};
