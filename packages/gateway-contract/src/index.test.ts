import { describe, expect, it } from 'vitest';
import { GATEWAY_CONTRACT_VERSION, KNOWN_GATEWAY_CAPABILITIES } from './index.js';

describe('gateway contract constants', () => {
  it('publishes the v0 contract version', () => {
    expect(GATEWAY_CONTRACT_VERSION).toBe('0.1');
  });

  it('keeps sub-capabilities alongside their parent capability', () => {
    expect(KNOWN_GATEWAY_CAPABILITIES).toContain('cache');
    expect(KNOWN_GATEWAY_CAPABILITIES).toContain('cache:clear');
  });
});
