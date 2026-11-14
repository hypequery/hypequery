import { readFile } from 'node:fs/promises';
import { CliError, type CliInputIssue } from '../cli-error.js';
import type { CloudCommandField, CloudCommandShape } from './command-shape.js';

/**
 * Turns a command line into the operation's input: `--input-json` first (a
 * JSON object, `@file` or `-` for stdin), then positional arguments and flags
 * on top, then the signed-in project for `--project`. Values are parsed by the
 * field's schema type; Cloud validates everything else and answers
 * INVALID_INPUT with the fields to fix.
 */
export interface OperationInputContext {
  /** The project slug the stored sign-in names, for project-scoped operations. */
  readonly defaultProject?: string;
  /** Reads all of stdin; called at most once. */
  readonly readStdin: () => Promise<string>;
  /** A hidden prompt for a secret field, when a person is at a terminal; undefined otherwise. */
  readonly promptSecret?: (field: CloudCommandField) => Promise<string>;
  readonly readTextFile?: (path: string) => Promise<string>;
}

function invalid(field: CloudCommandField, message: string): CliError {
  return new CliError('INVALID_OPTION', `${field.flag} ${message}`, {
    hint: `Fix ${field.flag} and run the command again.`,
    issues: [{ path: field.flag, message }],
  });
}

/** Parse one command-line string by the field's kind. `null` is JSON null where the field allows it. */
export function parseFieldValue(field: CloudCommandField, text: string): unknown {
  if (field.nullable && text === 'null') return null;
  switch (field.kind) {
    case 'string':
      if (field.choices && !field.choices.includes(text)) {
        throw invalid(field, `must be one of: ${field.choices.join(', ')}.`);
      }
      return text;
    case 'integer': {
      if (!/^-?\d+$/.test(text.trim())) throw invalid(field, 'expects a whole number.');
      const value = Number(text);
      if (!Number.isSafeInteger(value)) throw invalid(field, 'is too large.');
      return value;
    }
    case 'number': {
      const value = Number(text);
      if (text.trim() === '' || !Number.isFinite(value)) throw invalid(field, 'expects a number.');
      return value;
    }
    case 'boolean':
      if (text === 'true') return true;
      if (text === 'false') return false;
      throw invalid(field, 'expects true or false.');
    case 'list':
      if (field.choices && !field.choices.includes(text)) {
        throw invalid(field, `values must be among: ${field.choices.join(', ')}.`);
      }
      return text;
    case 'json':
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw invalid(field, 'expects JSON.');
      }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readInputJson(
  source: string,
  context: OperationInputContext,
): Promise<Record<string, unknown>> {
  let text: string;
  if (source === '-') {
    text = await context.readStdin();
  } else if (source.startsWith('@')) {
    try {
      text = await (context.readTextFile ?? ((path: string) => readFile(path, 'utf8')))(source.slice(1));
    } catch {
      throw new CliError('INVALID_OPTION', `--input-json could not read ${source.slice(1)}.`, {
        hint: 'Pass a JSON object, @<file> or - for stdin.',
        issues: [{ path: '--input-json', message: 'unreadable file' }],
      });
    }
  } else {
    text = source;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!isRecord(parsed)) {
    throw new CliError('INVALID_OPTION', '--input-json expects a JSON object (inline, @<file> or - for stdin).', {
      hint: 'Pass the operation input as a JSON object.',
      issues: [{ path: '--input-json', message: 'not a JSON object' }],
    });
  }
  return parsed;
}

function stripTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, '');
}

export async function buildOperationInput(
  shape: CloudCommandShape,
  positionals: readonly string[],
  options: Readonly<Record<string, unknown>>,
  context: OperationInputContext,
): Promise<Record<string, unknown>> {
  const secretFromStdin = shape.fields.filter(field => field.placement === 'secret' && options[field.key] === true);
  if (options.inputJson === '-' && secretFromStdin.length > 0) {
    throw new CliError('INVALID_OPTION', `--input-json - and ${secretFromStdin[0]!.flag} both read stdin; use one.`, {
      hint: 'Put the secret in the --input-json object, or pass --input-json as @<file>.',
    });
  }
  if (secretFromStdin.length > 1) {
    throw new CliError('INVALID_OPTION', `${secretFromStdin.map(field => field.flag).join(' and ')} both read stdin; use one.`, {
      hint: 'Pass the other secret in --input-json.',
    });
  }

  const input: Record<string, unknown> = typeof options.inputJson === 'string'
    ? await readInputJson(options.inputJson, context)
    : {};
  // `--yes` is the only way to confirm; a `confirm` inside --input-json is ignored.
  delete input.confirm;

  let argumentIndex = 0;
  for (const field of shape.fields) {
    switch (field.placement) {
      case 'argument': {
        const text = positionals[argumentIndex++];
        if (text !== undefined) input[field.property] = parseFieldValue(field, text);
        break;
      }
      case 'project': {
        if (typeof options.project === 'string') input.project = options.project;
        else if (input.project === undefined && shape.operation.scope === 'project' && context.defaultProject) {
          input.project = context.defaultProject;
        }
        break;
      }
      case 'option': {
        const value = options[field.key];
        if (value === undefined) break;
        if (field.kind === 'boolean') input[field.property] = value;
        else if (field.kind === 'list') {
          const items = value as readonly string[];
          input[field.property] = items.length === 1 && field.nullable && items[0] === 'null'
            ? null
            : items.map(item => parseFieldValue(field, item));
        } else input[field.property] = parseFieldValue(field, String(value));
        break;
      }
      case 'secret': {
        if (options[field.key] === true) {
          // At a terminal, stdin would echo the secret as it is typed: ask for it hidden instead.
          input[field.property] = context.promptSecret
            ? await context.promptSecret(field)
            : stripTrailingNewline(await context.readStdin());
        } else if (input[field.property] === undefined && field.required && context.promptSecret) {
          input[field.property] = await context.promptSecret(field);
        }
        break;
      }
      case 'confirm':
        break;
    }
  }

  const missing: CliInputIssue[] = shape.fields
    .filter(field => field.required && field.placement !== 'confirm' && input[field.property] === undefined)
    .map(field => ({ path: field.flag, message: field.placement === 'project'
      ? 'required: pass --project <slug>, or sign in with `hypequery login --device --project <slug>`'
      : field.placement === 'secret'
        ? `required: pipe it to ${field.flag}, or set "${field.property}" in --input-json`
        : 'required' }));
  if (missing.length > 0) {
    const names = missing.map(issue => issue.path).join(', ');
    throw new CliError('MISSING_INPUT', `hypequery ${shape.group} ${shape.action} needs ${names}.`, {
      hint: `Pass ${names}, or the whole input as --input-json.`,
      issues: missing,
    });
  }
  return input;
}
