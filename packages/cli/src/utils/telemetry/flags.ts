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
    if (/^-[^-].+/.test(arg)) {
      for (const letter of arg.slice(1)) {
        const short = `-${letter}`;
        const canonical = short === '-h' && command !== 'dev' ? '--help' : SHORT_FLAGS[short as keyof typeof SHORT_FLAGS];
        if (!canonical || !allowed.includes(canonical)) break;
        flags.add(canonical as TelemetryFlag);
        // The remainder is an attached value, never another flag.
        if (['--output', '--port', '--hostname'].includes(canonical)) break;
      }
      continue;
    }
    const name = arg.split('=', 1)[0];
    const canonical = name === '-h' && command !== 'dev'
      ? '--help' : SHORT_FLAGS[name as keyof typeof SHORT_FLAGS] ?? name;
    if (allowed.includes(canonical)) flags.add(canonical as TelemetryFlag);
  }
  return [...flags].sort();
}
