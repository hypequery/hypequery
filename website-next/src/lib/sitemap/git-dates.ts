import { execFileSync } from 'node:child_process';
import path from 'node:path';

// `next build` runs from website-next/, one level below the repository root.
const REPO_ROOT = path.join(process.cwd(), '..');

let fullHistory: boolean | undefined;

/**
 * Whether the checkout has full Git history. A shallow clone (Vercel's default)
 * shows every file as added in its oldest commit, so dates read from it would be
 * wrong; VERCEL_DEEP_CLONE=true gives the build a full history.
 */
function hasFullHistory(): boolean {
  if (fullHistory === undefined) {
    try {
      fullHistory =
        execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim() ===
        'false';
    } catch {
      fullHistory = false;
    }
  }
  return fullHistory;
}

/** The last commit date for a repository-relative path, or undefined without full history. */
export function gitLastModified(repoPath: string): Date | undefined {
  if (!hasFullHistory()) return undefined;
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%aI', '--', repoPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    return iso ? new Date(iso) : undefined;
  } catch {
    return undefined;
  }
}
