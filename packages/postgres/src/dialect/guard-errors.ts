/**
 * Postgres has no expression that raises an error, so a planner guard is
 * spelled as a cast that fails with the guard's message:
 *
 *   CAST(CASE WHEN <condition> THEN '[hypequery] <message>' ELSE '0' END AS integer)
 *
 * It evaluates to 0, or fails with `invalid input syntax for type integer:
 * "[hypequery] <message>"`. The CASE sits inside the cast, so the input stays
 * non-constant and the planner cannot fold the error into a statement whose
 * condition never holds. Drivers turn that error back into the message.
 */
export const GUARD_PREFIX = '[hypequery] ';

const INVALID_TEXT_REPRESENTATION = '22P02';
const GUARD_MESSAGE = /invalid input syntax for type integer: "\[hypequery\] ([^"]*)"/;

/** The guard message a Postgres error carries, if it is a planner guard. */
export function guardMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== INVALID_TEXT_REPRESENTATION || typeof message !== 'string') return undefined;
  return GUARD_MESSAGE.exec(message)?.[1];
}

/** Re-throw a planner guard as its own message; pass any other error through. */
export function toGuardError(error: unknown): unknown {
  const message = guardMessage(error);
  return message === undefined ? error : new Error(message, { cause: error });
}
