import { isPromptCancelled } from '../prompts.js';
import { CommandExit } from '../command-exit.js';
import { ERROR_CODES } from './domains.js';

export function telemetryErrorCode(error: unknown): typeof ERROR_CODES[number] {
  if (error instanceof CommandExit) return error.errorCode ?? 'unknown';
  if (isPromptCancelled(error)) return 'prompt_cancelled';
  if (!error || typeof error !== 'object') return 'unknown';
  try {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      if ((ERROR_CODES as readonly string[]).includes(code)) return code as typeof ERROR_CODES[number];
      if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'connection_failed';
      if (['UNAUTHORIZED', 'FORBIDDEN', 'AUTHENTICATION_FAILED'].includes(code)) return 'auth_failed';
      if (code === 'commander.unknownCommand') return 'unknown_command';
      if (code === 'commander.unknownOption') return 'unknown_option';
      if (code.startsWith('commander.')) return 'validation_failed';
    }
    // Some existing libraries expose only messages. Classify locally and discard
    // the text; the returned value is always from the closed catalog.
    if (error instanceof Error) {
      if (/authentication failed|unauthorized|forbidden/i.test(error.message)) return 'auth_failed';
      if (/build failed|compilation failed|transform failed/i.test(error.message)) return 'compile_error';
      if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|network error/i.test(error.message)) return 'connection_failed';
    }
  } catch { /* No error content is retained. */ }
  return 'unknown';
}

export function exceptionClass(error: unknown): 'Error' | 'TypeError' | 'RangeError' | 'SyntaxError' | 'ReferenceError' | 'URIError' | 'EvalError' | 'AggregateError' | 'unknown' {
  if (error instanceof TypeError) return 'TypeError';
  if (error instanceof RangeError) return 'RangeError';
  if (error instanceof SyntaxError) return 'SyntaxError';
  if (error instanceof ReferenceError) return 'ReferenceError';
  if (error instanceof URIError) return 'URIError';
  if (error instanceof EvalError) return 'EvalError';
  if (error instanceof AggregateError) return 'AggregateError';
  return error instanceof Error ? 'Error' : 'unknown';
}
