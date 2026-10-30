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
  | { kind: "too-large" }
  | { kind: "raw"; buffer: Buffer }
  | { kind: "parsed"; value: unknown };

/**
 * How to read a string `req.body` on a JSON request: as raw text, or as a JSON
 * value a parser already decoded (`express.json({ strict: false })` turns
 * `"123"` into the string `123`) and must not be parsed again.
 *
 * Raw text has exactly the byte length the client declared, and a decoded
 * JSON string is at least two bytes shorter because its quotes are gone, so
 * the lengths decide whenever they can be compared. A chunked body declares no
 * length, and a compressed one declares the compressed length; then the text
 * decides: raw text that is a JSON object or array is what an endpoint takes
 * (and is returned already parsed), while a decoded string is kept as a
 * string, so `"123"` never becomes `123`.
 *
 * Supported limitation: without a comparable length, raw text that is a bare
 * JSON primitive (`express.text()` given `123`, `true` or `null`) cannot be
 * told from a decoded string and stays a string. An endpoint taking a
 * primitive behind `express.text()` should receive a declared-length body, or
 * sit behind `express.json()` instead.
 */
const readJsonString = (
  req: IncomingMessage,
  body: string,
  byteLength: number,
): PreParsedBody => {
  const encoding = req.headers["content-encoding"];
  const declared = req.headers["content-length"];
  const comparable =
    (encoding === undefined || encoding.trim().toLowerCase() === "identity") &&
    declared !== undefined &&
    /^\d+$/.test(declared);
  if (comparable) {
    return Number(declared) === byteLength
      ? { kind: "raw", buffer: Buffer.from(body, "utf8") }
      : { kind: "parsed", value: body };
  }
  const value = parseJsonObjectText(body);
  return { kind: "parsed", value: value === undefined ? body : value };
};

/** The object or array *text* encodes as JSON, or undefined for anything else. */
const parseJsonObjectText = (text: string): object | undefined => {
  const first = text.trimStart()[0];
  if (first !== "{" && first !== "[") return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The body an upstream parser left on `req.body`, held to *bodyLimit* bytes
 * (0 for none) before any of it is parsed. Buffers and strings
 * (express.raw(), express.text()) are raw bytes for the adapter's own
 * content-type parsing, except a string on a JSON request that a JSON parser
 * already decoded (`readJsonString`); anything else is used as-is.
 */
export const readPreParsedBody = (req: IncomingMessage, bodyLimit = 0): PreParsedBody => {
  const { body } = req as FrameworkRequest;
  if (body === undefined) return { kind: "none" };
  if (Buffer.isBuffer(body)) {
    return bodyLimit > 0 && body.length > bodyLimit
      ? { kind: "too-large" }
      : { kind: "raw", buffer: body };
  }
  if (typeof body !== "string") return { kind: "parsed", value: body };
  const byteLength = Buffer.byteLength(body, "utf8");
  if (bodyLimit > 0 && byteLength > bodyLimit) return { kind: "too-large" };
  const contentType = req.headers["content-type"];
  if (typeof contentType === "string" && contentType.includes("application/json")) {
    return readJsonString(req, body, byteLength);
  }
  return { kind: "raw", buffer: Buffer.from(body, "utf8") };
};
