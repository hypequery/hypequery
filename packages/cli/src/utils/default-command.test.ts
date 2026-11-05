import { describe, expect, it } from 'vitest';
import { isInteractiveTerminal, withDefaultCommand } from './default-command.js';

describe('withDefaultCommand', () => {
  const interactive = { interactive: true };

  it('routes a bare invocation to init in an interactive terminal', () => {
    expect(withDefaultCommand([], interactive)).toEqual(['init']);
  });

  it('keeps root options ahead of the default command', () => {
    expect(withDefaultCommand(['--no-telemetry'], interactive)).toEqual(['--no-telemetry', 'init']);
  });

  it('leaves a bare invocation alone when not interactive', () => {
    expect(withDefaultCommand([], { interactive: false })).toEqual([]);
    expect(withDefaultCommand(['--no-telemetry'], { interactive: false })).toEqual(['--no-telemetry']);
  });

  it.each([
    [['dev']],
    [['init', '--force']],
    [['--help']],
    [['-h']],
    [['--version']],
    [['-V']],
    [['--no-telemetry', 'dev']],
    [['--force']],
    [['unknown-command']],
  ])('does not change %j', (args) => {
    expect(withDefaultCommand(args, interactive)).toEqual(args);
  });
});

describe('isInteractiveTerminal', () => {
  it('requires both stdin and stdout to be terminals', () => {
    expect(isInteractiveTerminal({ isTTY: true }, { isTTY: true })).toBe(true);
    expect(isInteractiveTerminal({ isTTY: true }, {})).toBe(false);
    expect(isInteractiveTerminal({}, { isTTY: true })).toBe(false);
    expect(isInteractiveTerminal({ isTTY: false }, { isTTY: false })).toBe(false);
  });
});
