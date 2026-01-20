import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ensureTypeScriptRuntime,
  setTypeScriptRuntimeImporter,
  resetTypeScriptRuntimeForTesting,
} from './ensure-ts-runtime.js';

describe('ensure TypeScript runtime', () => {
  beforeEach(() => {
    resetTypeScriptRuntimeForTesting();
  });

  afterEach(() => {
    resetTypeScriptRuntimeForTesting();
  });

  it('only loads the runtime once', async () => {
    let calls = 0;
    setTypeScriptRuntimeImporter(async () => {
      calls += 1;
    });

    await ensureTypeScriptRuntime();
    await ensureTypeScriptRuntime();

    expect(calls).toBe(1);
  });

  it('retries loading if the importer fails', async () => {
    let calls = 0;
    setTypeScriptRuntimeImporter(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('tsx exploded');
      }
    });

    await expect(ensureTypeScriptRuntime()).rejects.toThrow('tsx exploded');
    await expect(ensureTypeScriptRuntime()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
