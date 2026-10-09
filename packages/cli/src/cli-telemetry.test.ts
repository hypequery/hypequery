import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./commands/telemetry.js', () => ({ telemetryCommand: vi.fn() }));
import { telemetryCommand } from './commands/telemetry.js';
import { program } from './cli.js';

describe('global telemetry option', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    program.setOptionValue('telemetry', true);
  });

  it.each([
    ['--no-telemetry', 'telemetry', 'status'],
    ['telemetry', 'status', '--no-telemetry'],
  ])('applies before or after the subcommand: %j', async (...args) => {
    await program.parseAsync(args, { from: 'user' });
    expect(telemetryCommand).toHaveBeenCalledWith('status', { telemetry: false });
  });

  it('uses status when no action is supplied', async () => {
    await program.parseAsync(['telemetry'], { from: 'user' });
    expect(telemetryCommand).toHaveBeenCalledWith(undefined, { telemetry: true });
  });

  it('accepts the global opt-out on every registered command', () => {
    // Help parsing exercises global options without running database or Cloud actions.
    program.exitOverride();
    program.configureOutput({ writeOut: () => undefined });
    for (const command of program.commands) {
      command.exitOverride();
      command.configureOutput({ writeOut: () => undefined });
      expect(() => program.parse([command.name(), '--no-telemetry', '--help'], { from: 'user' }))
        .toThrow(expect.objectContaining({ code: 'commander.helpDisplayed' }));
      expect(program.opts().telemetry).toBe(false);
      program.setOptionValue('telemetry', true);
    }
  });
});
