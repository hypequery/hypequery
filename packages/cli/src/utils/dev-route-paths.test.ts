import { describe, expect, it } from 'vitest';
import { resolveDevRoutePaths } from './dev-route-paths.js';

describe('resolveDevRoutePaths', () => {
  it('reads served paths from describe(), which createAPI results expose without basePath', () => {
    const api = {
      describe: () => ({
        queries: [
          { key: 'orders', path: '/api/analytics/datasets/orders/query' },
          { key: '__hypequery_openapi__', path: '/api/analytics/openapi.json' },
          { key: '__hypequery_docs__', path: '/api/analytics/docs' },
        ],
      }),
    };

    expect(resolveDevRoutePaths(api)).toEqual({
      docs: '/api/analytics/docs',
      openapi: '/api/analytics/openapi.json',
    });
  });

  it('falls back to basePath and default paths', () => {
    expect(resolveDevRoutePaths({ basePath: '/api' })).toEqual({
      docs: '/api/docs',
      openapi: '/api/openapi.json',
    });
    expect(resolveDevRoutePaths({})).toEqual({ docs: '/docs', openapi: '/openapi.json' });
  });
});
