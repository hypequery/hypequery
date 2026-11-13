import { CLI_ERROR_CATEGORIES, type CliErrorCategory, type CloudErrorDetails } from './cli-error.js';

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
 * Read the hint, category and request ID from Cloud's error envelope
 * (decision 0019 §6). Older Cloud versions send only `{ error: { code,
 * message } }` and some send nothing, so every field is optional and an
 * unreadable body yields `{}`; the HTTP status stays authoritative.
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
  const category = (CLI_ERROR_CATEGORIES as readonly unknown[]).includes(fields.category)
    ? fields.category as CliErrorCategory
    : undefined;
  const hint = safeText(fields.hint);
  const requestId = typeof fields.requestId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(fields.requestId)
    ? fields.requestId
    : undefined;
  return {
    ...(hint ? { hint } : {}),
    ...(category ? { category } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

/** Read and parse a failed response's body without letting a broken body hide the status. */
export async function cloudErrorDetails(response: { text(): Promise<string> }): Promise<CloudErrorDetails> {
  try {
    return parseCloudErrorBody(await response.text());
  } catch {
    return {};
  }
}
