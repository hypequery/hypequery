import type { FetchHandler, HttpMethod, ServeHandler, ServeRequest } from "../types.js";
import {
  isNullBodyStatus,
  normalizeHeaders,
  parseQueryParams,
  parseRequestBody,
  serializeResponseBody,
} from "./utils.js";
import { isServeStreamBody } from "../utils/stream-body.js";
import { withContentType, withDefaultContentType } from "../utils/response-headers.js";

export const createFetchHandler = (handler: ServeHandler): FetchHandler => {
  return async (request: Request) => {
    const url = new URL(request.url);
    const headers = normalizeHeaders(request.headers);
    const contentType = headers["content-type"];

    const serveRequest: ServeRequest = {
      method: (request.method ?? "GET").toUpperCase() as HttpMethod,
      path: url.pathname,
      query: parseQueryParams(url.searchParams),
      headers,
      body: await parseRequestBody(request, contentType),
      raw: request,
    };

    const response = await handler(serveRequest);
    if (isServeStreamBody(response.body)) {
      if (isNullBodyStatus(response.status)) {
        // These statuses carry no body: stop the stream rather than leave it open.
        await response.body.stream.cancel().catch(() => undefined);
        return new Response(null, { status: response.status, headers: response.headers });
      }
      // The runtime cancels the stream when the client goes away.
      return new Response(response.body.stream, {
        status: response.status,
        headers: withContentType(response.headers, response.body.contentType),
      });
    }
    const responseHeaders = withDefaultContentType(
      response.headers,
      "application/json; charset=utf-8",
    );

    const body = isNullBodyStatus(response.status)
      ? null
      : serializeResponseBody(response.body);

    return new Response(body, {
      status: response.status,
      headers: responseHeaders,
    });
  };
};
