/**
 * `codex mcp get <name> --json` as the entry shape the JSON agents use
 * (`command`, `args`, `env`, or `url`), so the same checks apply to Codex.
 * Undefined when the output is not that JSON (an older Codex).
 */
export function codexEntry(stdout: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const transport = (parsed as { transport?: unknown }).transport;
  if (typeof transport !== 'object' || transport === null) return undefined;
  const record = transport as Record<string, unknown>;
  if (typeof record.url === 'string') return { url: record.url };
  if (typeof record.command !== 'string') return undefined;
  return {
    command: record.command,
    args: Array.isArray(record.args) ? record.args.filter(arg => typeof arg === 'string') : [],
    env: typeof record.env === 'object' && record.env !== null ? record.env : {},
  };
}
