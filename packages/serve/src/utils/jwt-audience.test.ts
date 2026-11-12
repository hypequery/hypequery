import { describe, expect, it } from 'vitest';
import { createJwtStrategy } from '../auth.js';
import { attachJwtAudience, readJwtAudience } from './jwt-audience.js';

const secret = 'jwt-audience-test-secret-0123456789abcdef';

describe('JWT strategy audiences', () => {
  it('records what createJwtStrategy accepts, without verifying a token', () => {
    expect(readJwtAudience(createJwtStrategy({ secret, audience: 'https://mcp.example.test/mcp' })))
      .toEqual(['https://mcp.example.test/mcp']);
    expect(readJwtAudience(createJwtStrategy({ secret, audience: ['a', 'b'] }))).toEqual(['a', 'b']);
    // No audience configured: any token from the issuer is accepted, which a host must be able to see.
    expect(readJwtAudience(createJwtStrategy({ secret }))).toEqual([]);
  });

  it('says nothing about strategies it does not know', () => {
    expect(readJwtAudience(async () => null)).toBeUndefined();
    expect(readJwtAudience({})).toBeUndefined();
    expect(readJwtAudience(undefined)).toBeUndefined();
  });

  it('is invisible to enumeration and cannot be rewritten', () => {
    const strategy = attachJwtAudience(async () => null, 'a');
    expect(Object.keys(strategy)).toEqual([]);
    expect(() => attachJwtAudience(strategy, 'b')).toThrow();
    expect(readJwtAudience(strategy)).toEqual(['a']);
  });
});
