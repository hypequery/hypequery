import type { FetchHandler, HttpMethod, ServeHandler, ServeRequest } from "../types";

const extractHeaders = (request: Request) => {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
};

const buildQuery = (url: URL) => {
  const params: Record<string, string | string[] | undefined> = {};

  url.searchParams.forEach((value, key) => {
    if (params[key] === undefined) {
      params[key] = value;
    } else if (Array.isArray(params[key])) {
      (params[key] as string[]).push(value);
    } else {
      params[key] = [params[key] as string, value];
    }
  });

  return params;
};

const parseBody = async (request: Request, headers: Record<string, string>) => {
  const contentType = headers["content-type"];

  if (!contentType) {
    return undefined;
  }

  if (contentType.includes("application/json")) {
    try {
      return await request.json();
    } catch {
      return undefined;
    }
  }

  if (contentType.includes("text/")) {
    return await request.text();
  }

  return await request.arrayBuffer();
};

export const createFetchHandler = (handler: ServeHandler): FetchHandler => {
  return async (request: Request) => {
    const url = new URL(request.url);
    const headers = extractHeaders(request);
    const serveRequest: ServeRequest = {
      method: (request.method ?? "GET").toUpperCase() as HttpMethod,
      path: url.pathname,
      query: buildQuery(url),
      headers,
      body: await parseBody(request, headers),
      raw: request,
    };

    const response = await handler(serveRequest);
    return new Response(JSON.stringify(response.body ?? null), {
      status: response.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...response.headers,
      },
    });
  };
};
