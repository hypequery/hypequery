import { describe, it, expect } from 'vitest';
import { envFiles } from './env-files.js';

describe('envFiles', () => {
  it('reads .env.local, which Next.js and Vite projects actually use', () => {
    // Previously only `.env` was loaded, so a Next.js project with credentials
    // in `.env.local` failed with "Unable to detect database type".
    expect(envFiles(undefined)).toContain('.env.local');
  });

  it('orders most specific first, so earlier files win', () => {
    expect(envFiles('production')).toEqual([
      '.env.production.local',
      '.env.local',
      '.env.production',
      '.env',
    ]);
  });

  it('omits NODE_ENV-specific files when NODE_ENV is unset', () => {
    expect(envFiles(undefined)).toEqual(['.env.local', '.env']);
  });

  it('always ends at .env so existing setups keep working', () => {
    for (const nodeEnv of [undefined, 'development', 'production', 'test']) {
      expect(envFiles(nodeEnv).at(-1)).toBe('.env');
    }
  });
});
