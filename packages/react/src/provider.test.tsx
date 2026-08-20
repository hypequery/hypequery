import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createHypequeryClient } from './client.js';
import { createHooks } from './createHooks.js';
import { HypequeryProvider } from './provider.js';

type TestApi = {
  greeting: {
    input: { name: string };
    output: { message: string };
  };
};

function success(data: unknown) {
  return { ok: true, status: 200, json: async () => data } as Response;
}

describe('HypequeryProvider', () => {
  it('configures generated hooks once and supplies their TanStack Query client', async () => {
    const fetchFn = vi.fn().mockResolvedValue(success({ message: 'Hello Luke' }));
    const client = createHypequeryClient<TestApi>({
      baseUrl: 'https://acme.hypequery.cloud/v1/analytics/production',
      token: async () => 'browser-token',
      fetchFn: fetchFn as unknown as typeof fetch,
      manifest: { greeting: { method: 'GET', path: 'queries/greeting' } },
    });
    const { useQuery } = createHooks<TestApi>();
    const wrapper = ({ children }: PropsWithChildren) => (
      <HypequeryProvider client={client}>{children}</HypequeryProvider>
    );

    const { result } = renderHook(
      () => useQuery('greeting', { name: 'Luke' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toEqual({ message: 'Hello Luke' }));
    expect(fetchFn).toHaveBeenCalledWith(
      'https://acme.hypequery.cloud/v1/analytics/production/queries/greeting?name=Luke',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer browser-token' }),
      }),
    );
  });
});
