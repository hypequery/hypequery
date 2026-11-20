import { describe, expect, it } from 'vitest';
import { isSupportedNode, unsupportedNodeMessage } from './node-version.js';

describe('Node version guard', () => {
  it.each([
    ['v22.12.0', true], ['v22.23.4', true], ['v24.0.0', true], ['v26.1.0', true],
    ['v22.11.9', false], ['v20.19.0', false], ['v18.20.4', false],
  ])('%s supported: %s', (version, supported) => {
    expect(isSupportedNode(version)).toBe(supported);
  });

  it('names the version needed and how to get it', () => {
    expect(unsupportedNodeMessage('v20.1.0')).toMatch(/needs Node 22\.12\.0 or newer, but this is Node 20\.1\.0.*nvm install 24/);
  });
});
