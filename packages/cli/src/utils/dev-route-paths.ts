const DOCS_ROUTE_KEY = '__hypequery_docs__';
const OPENAPI_ROUTE_KEY = '__hypequery_openapi__';

export interface DevRouteApi {
  basePath?: string;
  docs?: { path?: string };
  openapi?: { path?: string };
  describe?: () => { queries?: Array<{ key: string; path: string }> };
}

/**
 * Docs and OpenAPI paths the API actually serves. `describe()` lists both
 * routes with the base path applied for `serve()` and `createAPI()` alike;
 * only `serve()` results carry a `basePath` property, so the fallback alone
 * drops the prefix for `createAPI()` entries.
 */
export function resolveDevRoutePaths(api: DevRouteApi): { docs: string; openapi: string } {
  const routes = typeof api.describe === 'function' ? api.describe().queries ?? [] : [];
  const routePath = (key: string) => routes.find(route => route.key === key)?.path;

  return {
    docs: routePath(DOCS_ROUTE_KEY) ?? `${api.basePath ?? ''}${api.docs?.path ?? '/docs'}`,
    openapi: routePath(OPENAPI_ROUTE_KEY) ?? `${api.basePath ?? ''}${api.openapi?.path ?? '/openapi.json'}`,
  };
}
