/**
 * Exhaustiveness guard for discriminated unions.
 *
 * Calling this in a `default:` branch makes TypeScript fail to compile if a new
 * case is added to the union but not handled. At runtime (which is unreachable
 * for well-typed input) it throws.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}
