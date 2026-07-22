import { describe, expect, it } from 'vitest';
import { normalizeGatewayBaseUrl, resolveStudioRuntimeConfig } from './runtime-config';

describe('Studio runtime configuration', () => {
  it('uses an injected absolute Cloud gateway URL', () => {
    expect(
      resolveStudioRuntimeConfig({
        injected: { gatewayBaseUrl: 'https://api.example.com/studio/' },
        pathname: '/ignored/',
      })
    ).toEqual({ gatewayBaseUrl: 'https://api.example.com/studio' });
  });

  it('uses the current mount path for a same-origin gateway', () => {
    expect(resolveStudioRuntimeConfig({ pathname: '/local-tools/' })).toEqual({
      gatewayBaseUrl: '/local-tools',
    });
  });

  it('normalizes the same-origin root to an empty URL prefix', () => {
    expect(normalizeGatewayBaseUrl('/')).toBe('');
  });
});
