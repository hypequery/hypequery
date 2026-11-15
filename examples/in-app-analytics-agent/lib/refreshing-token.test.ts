import { describe, expect, it } from 'vitest';
import { refreshingToken } from './refreshing-token';

describe('refreshingToken', () => {
  it('mints once, reuses the token, and re-mints a minute before expiry', async () => {
    let clock = 0;
    let mints = 0;
    const mint = async () => {
      mints += 1;
      return { token: `t${mints}`, mcpUrl: 'https://x.hypequery.app/mcp', expiresAt: new Date(clock + 900_000) };
    };
    const { mcpUrl, token } = await refreshingToken(mint, () => clock);
    expect(mcpUrl).toBe('https://x.hypequery.app/mcp');
    expect(await token()).toBe('t1');
    clock = 839_000;
    expect(await token()).toBe('t1');
    clock = 841_000;
    expect(await token()).toBe('t2');
    expect(mints).toBe(2);
  });
});
