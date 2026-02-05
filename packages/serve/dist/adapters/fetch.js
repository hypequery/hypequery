import { normalizeHeaders, parseQueryParams, parseRequestBody, serializeResponseBody, } from "./utils.js";
export const createFetchHandler = (handler) => {
    return async (request) => {
        const url = new URL(request.url);
        const headers = normalizeHeaders(request.headers);
        const contentType = headers["content-type"];
        const serveRequest = {
            method: (request.method ?? "GET").toUpperCase(),
            path: url.pathname,
            query: parseQueryParams(url.searchParams),
            headers,
            body: await parseRequestBody(request, contentType),
            raw: request,
        };
        const response = await handler(serveRequest);
        const responseHeaders = {
            "content-type": "application/json; charset=utf-8",
            ...response.headers,
        };
        const body = serializeResponseBody(response.body);
        return new Response(body, {
            status: response.status,
            headers: responseHeaders,
        });
    };
};
