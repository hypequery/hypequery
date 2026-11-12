import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface FetchSourceInput {
  repository: string;
  ref: string;
  /** Repo-relative folders to materialise, e.g. ['examples/nextjs-dashboard', 'examples/_seed']. */
  dirs: string[];
}

export interface FetchedSource {
  /** Absolute path of the checkout; call `cleanup()` when done. */
  root: string;
  cleanup: () => Promise<void>;
}

export type SourceFetcher = (input: FetchSourceInput) => Promise<FetchedSource>;

function git(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => reject(new Error(`git is required to fetch examples: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args[0]} failed (${code}): ${stderr.trim()}`))));
  });
}

/**
 * A blobless, sparse, depth-1 clone: only the folders we need are
 * materialised, so fetching one example costs a few hundred kilobytes
 * rather than the whole repository. Needs `git` on PATH and network access.
 */
export const fetchSourceWithGit: SourceFetcher = async ({ repository, ref, dirs }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypequery-create-'));
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    await git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', ref, '--quiet', `https://github.com/${repository}.git`, root]);
    await git(['sparse-checkout', 'set', '--no-cone', ...dirs], root);
    for (const dir of dirs) {
      if (!existsSync(path.join(root, dir))) {
        throw new Error(`${dir} does not exist in ${repository}@${ref}`);
      }
    }
    return { root, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
