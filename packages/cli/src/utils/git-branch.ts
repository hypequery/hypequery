import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 5_000;

/**
 * Resolves the checked-out branch name, or null when there isn't one.
 *
 * `git symbolic-ref` exits non-zero on a detached HEAD and outside a
 * repository, and the binary may be missing entirely, so every failure mode
 * collapses to "no branch context" rather than an error the caller must handle.
 */
export async function currentGitBranch(
  cwd: string = process.cwd(),
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      {
        cwd,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    const branch = stdout.trim();
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}
