import { statSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_DIR_VARIABLE } from './agent-config/server-entry.js';

/**
 * The project an agent's MCP entry asked the CLI to run in
 * (`HYPEQUERY_PROJECT_DIR`, written by `hypequery mcp:install`). Agents start
 * servers in a directory of their choosing, so the executable changes into
 * the project before it loads `.env` or looks for the Serve API. Only an
 * absolute path to an existing directory is used.
 */
export function requestedProjectDirectory(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const value = env[PROJECT_DIR_VARIABLE]?.trim();
  if (!value) return undefined;
  if (!path.isAbsolute(value)) throw new Error(`${PROJECT_DIR_VARIABLE} must be an absolute path, not "${value}".`);
  let isDirectory = false;
  try {
    isDirectory = statSync(value).isDirectory();
  } catch {
    // Reported below.
  }
  if (!isDirectory) {
    throw new Error(`${PROJECT_DIR_VARIABLE} names ${value}, which is not a directory. Run \`hypequery mcp:install\` again from the project.`);
  }
  return value;
}
