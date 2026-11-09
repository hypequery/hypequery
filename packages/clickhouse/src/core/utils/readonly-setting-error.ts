/**
 * Whether ClickHouse rejected `setting` because the connection uses
 * `readonly = 1`. Code 164 also covers other settings and forbidden
 * operations, so the message must name this setting.
 */
export function isReadonlySettingError(error: unknown, setting: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, type } = error as { code?: unknown; type?: unknown };
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string' || !message.includes(setting)) return false;

  return code === '164'
    || code === 164
    || type === 'READONLY'
    || /in readonly mode/i.test(message);
}
