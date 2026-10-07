import { COMMANDS, COMMAND_FLAGS, GLOBAL_FLAGS, SHORT_FLAGS, type TelemetryCommand, type TelemetryFlag } from './domains.js';

export function knownCommand(input: string): TelemetryCommand {
  return (COMMANDS as readonly string[]).includes(input) ? input as TelemetryCommand : 'unknown';
}

/** Call with Commander's raw args for the selected command, never its option values. */
export function flagNames(command: TelemetryCommand, args: readonly string[]): TelemetryFlag[] {
  const allowed: readonly string[] = [...COMMAND_FLAGS[command], ...GLOBAL_FLAGS];
  const flags = new Set<TelemetryFlag>();
  for (const arg of args) {
    if (arg === '--') break;
    const name = arg.split('=', 1)[0];
    const canonical = name === '-h' && command !== 'dev'
      ? '--help' : SHORT_FLAGS[name as keyof typeof SHORT_FLAGS] ?? name;
    if (allowed.includes(canonical)) flags.add(canonical as TelemetryFlag);
  }
  return [...flags].sort();
}
