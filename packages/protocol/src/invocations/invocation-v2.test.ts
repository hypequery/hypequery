import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProtocolSemanticInvocationError,
  validateProtocolSemanticInvocation,
  validateProtocolSemanticInvocationV2,
} from './index.js';

interface Case { id: string; record: string; value: Record<string, unknown>; error?: string }

function fixture(name: string): Case[] {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/semantic-invocations-v2/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as Case[];
}

function code(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof ProtocolSemanticInvocationError) return error.code;
    throw error;
  }
}

describe('semantic invocation 2', () => {
  it('accepts the success fixtures and keeps their extension 2 operations', () => {
    for (const entry of fixture('success.json')) {
      const invocation = validateProtocolSemanticInvocationV2(entry.value);
      expect(invocation.version, entry.id).toBe(2);
      expect(invocation.operation, entry.id).toEqual(entry.value.operation);
    }
  });

  it('rejects the rejection fixtures with their stable codes', () => {
    for (const entry of fixture('rejections.json')) {
      expect(code(() => validateProtocolSemanticInvocationV2(entry.value)), entry.id).toBe(entry.error);
    }
  });

  it('keeps extension 2 operations out of invocation 1', () => {
    for (const entry of fixture('success.json')) {
      expect(code(() => validateProtocolSemanticInvocation({ ...entry.value, version: 1 })), entry.id)
        .toBe('HQ_INVOCATION_INVALID_VALUE');
    }
  });
});
