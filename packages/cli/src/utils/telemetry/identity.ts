import { createHash, randomUUID } from 'node:crypto';
import type { TelemetryConfig } from './config-schema.js';
import type { ProjectContext } from './project-context.js';

/** HQ-233: shared across installs; the proxy must re-key this digest before storage. */
export const PROJECT_HASH_SALT = 'hypequery.cli.project.v1:';

export function normalizeProjectRemote(input: string): string | undefined {
  try {
    const raw = input.trim();
    let url: URL;
    // SCP-style SSH remotes have no URL scheme. Local file paths are not signals.
    if (/^(?:[^/@\s]+@)?[^/:\s]+:[^\\\s]+$/.test(raw) && !raw.includes('://')) {
      const match = raw.match(/^(?:[^/@\s]+@)?([^/:\s]+):(.+)$/)!;
      if (match[1].length === 1) return undefined; // Windows drive path.
      url = new URL(`ssh://${match[1]}/${match[2]}`);
    } else {
      url = new URL(raw);
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return undefined;
    const repo = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    if (!url.hostname || !repo) return undefined;
    const standardPort = ({ 'ssh:': '22', 'git:': '9418', 'https:': '443', 'http:': '80' } as Record<string, string>)[url.protocol];
    const port = url.port && url.port !== standardPort ? `:${url.port}` : '';
    // Credentials, query, fragment and transport are excluded before hashing.
    return `${url.hostname.toLowerCase()}${port}/${repo}`;
  } catch { return undefined; }
}

export function projectId(context: ProjectContext): string | undefined {
  const remote = context.remote ? normalizeProjectRemote(context.remote) : undefined;
  const name = (context.rootPackage ?? context.package)?.name;
  const signal = remote ? `remote:${remote}` : typeof name === 'string' && name.trim()
    ? `package:${name.trim()}` : undefined;
  return signal ? createHash('sha256').update(PROJECT_HASH_SALT).update(signal).digest('hex') : undefined;
}

export function invocationIdentity(config: TelemetryConfig, context: ProjectContext) {
  const project = projectId(context);
  return { install_id: config.install_id, session_id: randomUUID(), ...(project ? { project_id: project } : {}) };
}
