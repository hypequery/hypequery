import { describe, expect, it, vi } from 'vitest';
import { requestSignIn } from './sign-in';

describe('requestSignIn', () => {
  it('posts the user id and resolves to nothing when signed in', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: 'ada' }));
    expect(await requestSignIn('ada', fetcher)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith('/api/session', expect.objectContaining({ method: 'POST', body: '{"userId":"ada"}' }));
  });

  it('resolves to a message, rather than rejecting, when the request fails', async () => {
    const offline: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await requestSignIn('ada', offline)).toMatch(/Could not reach the server/);
  });

  it('resolves to the route\u2019s error when it refuses', async () => {
    const refused: typeof fetch = async () => Response.json({ error: 'Unknown demo user.' }, { status: 400 });
    expect(await requestSignIn('nobody', refused)).toBe('Unknown demo user.');
    const broken: typeof fetch = async () => new Response('oops', { status: 502 });
    expect(await requestSignIn('ada', broken)).toBe('Could not sign in (HTTP 502).');
  });
});
