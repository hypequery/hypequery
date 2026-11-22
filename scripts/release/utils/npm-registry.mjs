// Thin wrappers over the npm CLI and the tarball download. They talk to the
// network; the rules they feed live in registry-verification.mjs.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { integrityMatches } from './registry-verification.mjs';

const execFileAsync = promisify(execFile);

/**
 * `npm view <spec> <fields...> --json`, bypassing npm's local cache. Returns
 * the parsed value, or null when the package or version does not resolve.
 */
export async function npmView(spec, fields = []) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', spec, ...fields, '--json', '--prefer-online'], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.trim() === '' ? null : JSON.parse(stdout);
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (/E404|No match found|is not in this registry/.test(output)) return null;
    throw new Error(`npm view ${spec} failed: ${output.trim().split('\n').slice(-3).join(' ') || error.message}`);
  }
}

/** True when `name@version` resolves on npm (single attempt, no retry). */
export async function versionResolves(pkg) {
  const version = await npmView(`${pkg.name}@${pkg.version}`, ['version']);
  return version === pkg.version;
}

/**
 * One verification attempt for a published version: `npm view` resolves the
 * exact version, and its tarball downloads and matches `dist.integrity`.
 */
export async function checkPublishedVersion(pkg) {
  const spec = `${pkg.name}@${pkg.version}`;
  const view = await npmView(spec, ['version', 'dist.tarball', 'dist.integrity']);
  if (!view) return { ok: false, reason: '`npm view` does not resolve the version' };
  if (view.version !== pkg.version) return { ok: false, reason: `\`npm view\` returned ${view.version}` };
  const tarball = view['dist.tarball'];
  if (!tarball) return { ok: false, reason: 'no dist.tarball in the registry metadata' };
  const response = await fetch(tarball, { headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) return { ok: false, reason: `tarball download returned HTTP ${response.status}` };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!integrityMatches(bytes, view['dist.integrity'])) {
    return { ok: false, reason: 'tarball does not match dist.integrity' };
  }
  return { ok: true };
}
