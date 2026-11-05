import { describe, expect, it } from 'vitest';
import { requestedCommand, suggestedCommand } from './requested-command.js';

const registered = ['init', 'dev', 'generate:datasets', 'help'];

describe('commands rejected before an action runs', () => {
  it('attributes bad options and arguments to the registered command', () => {
    expect(requestedCommand('dev', registered)).toBe('dev');
    expect(requestedCommand('generate:datasets', registered)).toBe('generate:datasets');
  });

  it('reports unregistered input as unknown, even when it names a catalog command', () => {
    expect(requestedCommand('frobnicate', registered)).toBe('unknown');
    expect(requestedCommand('version', registered)).toBe('unknown');
    expect(requestedCommand(undefined, registered)).toBe('unknown');
  });

  it('keeps only a registered suggestion, never the raw input', () => {
    const error = new Error("error: unknown command 'generate:dataset'\n(Did you mean generate:datasets?)");
    expect(suggestedCommand(error, registered)).toBe('generate:datasets');
    expect(suggestedCommand(new Error("error: unknown command 'PRIVATE'\n(Did you mean PRIVATE?)"), registered)).toBeUndefined();
    expect(suggestedCommand(new Error("error: unknown command 'PRIVATE'"), registered)).toBeUndefined();
    expect(suggestedCommand('PRIVATE', registered)).toBeUndefined();
    expect(suggestedCommand(null, registered)).toBeUndefined();
  });
});
