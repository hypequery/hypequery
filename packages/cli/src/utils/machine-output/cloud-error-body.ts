import { CLI_ERROR_CATEGORIES, type CliErrorCategory } from './cli-error.js';

/** The parts of Cloud's `{ error: { … } }` envelope (decision 0019 §6) the CLI relays. */
export interface CloudErrorDetails {
  readonly code?: string;
  readonly message?: string;
  readonly hint?: string;
  readonly category?: CliErrorCategory;
  readonly requestId?: string;
}

const MAX_FIELD_LENGTH = 512;

/** Control characters are replaced and length is bounded: the text reaches a terminal. */
function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const safe = [...value].map(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  }).join('').slice(0, MAX_FIELD_LENGTH).trim();
  return safe || undefined;
}

/**
 * Read Cloud's error envelope from a response body. Older Cloud versions send
 * only `{ error: { code, message } }` and some send nothing, so every field is
 * optional and an unreadable body yields `{}`; the HTTP status stays authoritative.
 */
export function parseCloudErrorBody(body: string): CloudErrorDetails {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {};
  }
  const error = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>).error
    : undefined;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return {};
  const fields = error as Record<string, unknown>;
  const code = typeof fields.code === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(fields.code) ? fields.code : undefined;
  const category = (CLI_ERROR_CATEGORIES as readonly unknown[]).includes(fields.category)
    ? fields.category as CliErrorCategory
    : undefined;
  const message = safeText(fields.message);
  const hint = safeText(fields.hint);
  const requestId = typeof fields.requestId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(fields.requestId)
    ? fields.requestId
    : undefined;
  return {
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(hint ? { hint } : {}),
    ...(category ? { category } : {}),
    ...(requestId ? { requestId } : {}),
  };
}
