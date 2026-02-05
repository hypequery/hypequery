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
export function normalizeHeaders(headers) {
    const normalized = {};
    if (headers instanceof Headers || (typeof Headers !== 'undefined' && headers instanceof Headers)) {
        // Web API Headers
        headers.forEach((value, key) => {
            normalized[key] = value;
        });
    }
    else {
        // Node.js headers (Record<string, string | string[] | undefined>)
        for (const [key, value] of Object.entries(headers)) {
            if (Array.isArray(value)) {
                normalized[key] = value.join(", ");
            }
            else if (typeof value === "string") {
                normalized[key] = value;
            }
        }
    }
    return normalized;
}
/**
 * Parses URL search parameters into a structured query object.
 * Handles multiple values for the same parameter by creating arrays.
 *
 * @param searchParams - URLSearchParams instance
 * @returns Query parameters with support for arrays
 */
export function parseQueryParams(searchParams) {
    const params = {};
    for (const [key, value] of searchParams.entries()) {
        if (params[key] === undefined) {
            params[key] = value;
        }
        else if (Array.isArray(params[key])) {
            params[key].push(value);
        }
        else {
            params[key] = [params[key], value];
        }
    }
    return params;
}
/**
 * Parses request body based on content type.
 * Supports Node.js Buffer and Web API Request.
 *
 * @param input - Buffer (Node.js) or Request (Web API)
 * @param contentType - Content-Type header value
 * @returns Parsed body (JSON object, string, ArrayBuffer, or undefined)
 */
export async function parseRequestBody(input, contentType) {
    // Node.js Buffer handling
    if (Buffer.isBuffer(input)) {
        if (!input.length) {
            return undefined;
        }
        if (contentType && contentType.includes("application/json")) {
            try {
                return JSON.parse(input.toString("utf8"));
            }
            catch {
                // If JSON parsing fails, return as string
                return input.toString("utf8");
            }
        }
        // Non-JSON content
        return input.length ? input.toString("utf8") : undefined;
    }
    // Web API Request handling
    if (!contentType) {
        return undefined;
    }
    if (contentType.includes("application/json")) {
        try {
            return await input.json();
        }
        catch {
            return undefined;
        }
    }
    if (contentType.includes("text/")) {
        return await input.text();
    }
    // Binary data (images, files, etc.)
    return await input.arrayBuffer();
}
/**
 * Serializes response body to string based on content type.
 * Handles JSON serialization and string passthrough.
 *
 * @param body - Response body (any type)
 * @param contentType - Content-Type header value
 * @returns Serialized body as string
 */
export function serializeResponseBody(body) {
    // If already a string, pass through as-is
    if (typeof body === "string") {
        return body;
    }
    // Otherwise, JSON stringify for JSON content-type or default
    return JSON.stringify(body ?? null);
}
