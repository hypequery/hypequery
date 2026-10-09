import { COMMANDS, COMMAND_FLAGS, GLOBAL_FLAGS, SHORT_FLAGS, VALUE_FLAGS, type TelemetryCommand, type TelemetryFlag } from './domains.js';

export function knownCommand(input: string): TelemetryCommand {
  return (COMMANDS as readonly string[]).includes(input) ? input as TelemetryCommand : 'unknown';
}

/** Call with Commander's raw args for the selected command, never its option values. */
export function flagNames(command: TelemetryCommand, args: readonly string[]): TelemetryFlag[] {
  const allowed: readonly string[] = [...COMMAND_FLAGS[command], ...GLOBAL_FLAGS];
  const takesValue: readonly string[] = VALUE_FLAGS[command];
  const flags = new Set<TelemetryFlag>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') break;
    if (/^-[^-].+/.test(arg)) {
      for (const [position, letter] of [...arg.slice(1)].entries()) {
        const short = `-${letter}`;
        const canonical = short === '-h' && command !== 'dev' ? '--help' : SHORT_FLAGS[short as keyof typeof SHORT_FLAGS];
        if (!canonical || !allowed.includes(canonical)) break;
        flags.add(canonical as TelemetryFlag);
        if (takesValue.includes(canonical)) {
          // A value is either attached (-p4000) or the next argument (-p 4000).
          if (position === arg.length - 2) index++;
          break;
        }
      }
      continue;
    }
    const name = arg.split('=', 1)[0];
    const canonical = name === '-h' && command !== 'dev'
      ? '--help' : SHORT_FLAGS[name as keyof typeof SHORT_FLAGS] ?? name;
    if (allowed.includes(canonical)) flags.add(canonical as TelemetryFlag);
    // Commander takes the next argument as a required value even when it starts
    // with "-", so it must not be read as flags (`--output -help.ts`).
    if (takesValue.includes(canonical) && !arg.includes('=')) index++;
  }
  return [...flags].sort();
}
