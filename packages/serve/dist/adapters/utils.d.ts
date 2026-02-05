/**
 * Shared utilities for HTTP adapters (Node.js, Fetch API, etc.)
 * These functions eliminate code duplication across different adapter implementations.
 */
/**
 * Normalizes headers from various sources into a consistent format.
 * Handles both Node.js IncomingMessage headers and Web API Headers.
 *
 * @param headers - Headers from Node.js (Record with string | string[]) or Web Headers
 * @returns Normalized headers as Record<string, string | undefined>
 */
export declare function normalizeHeaders(headers: Record<string, string | string[] | undefined> | Headers): Record<string, string | undefined>;
/**
 * Parses URL search parameters into a structured query object.
 * Handles multiple values for the same parameter by creating arrays.
 *
 * @param searchParams - URLSearchParams instance
 * @returns Query parameters with support for arrays
 */
export declare function parseQueryParams(searchParams: URLSearchParams): Record<string, string | string[] | undefined>;
/**
 * Parses request body based on content type.
 * Supports Node.js Buffer and Web API Request.
 *
 * @param input - Buffer (Node.js) or Request (Web API)
 * @param contentType - Content-Type header value
 * @returns Parsed body (JSON object, string, ArrayBuffer, or undefined)
 */
export declare function parseRequestBody(input: Buffer | Request, contentType?: string): Promise<unknown>;
/**
 * Serializes response body to string based on content type.
 * Handles JSON serialization and string passthrough.
 *
 * @param body - Response body (any type)
 * @param contentType - Content-Type header value
 * @returns Serialized body as string
 */
export declare function serializeResponseBody(body: unknown): string;
//# sourceMappingURL=utils.d.ts.map