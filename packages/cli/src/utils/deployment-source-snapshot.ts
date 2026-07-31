import { execFile } from 'node:child_process';
import { constants, lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
} from '@hypequery/protocol';
import { build } from 'esbuild';
import type {
  DeploymentBundleSourceFile,
  DeploymentBundleSourceSnapshot,
} from './deployment-bundle.js';
import { currentGitBranch } from './git-branch.js';
import { findNearestTsconfig } from './load-api.js';

function portableProjectPath(projectRoot: string, absolutePath: string): string {
  const relative = path.relative(projectRoot, absolutePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) {
    throw new Error('Deployment source files must remain inside the current project.');
  }
  return relative.split(path.sep).join('/');
}

async function readSourceFile(
  projectRoot: string,
  inputPath: string,
): Promise<DeploymentBundleSourceFile> {
  const absolutePath = path.resolve(projectRoot, inputPath);
  const displayPath = portableProjectPath(projectRoot, absolutePath);
  const resolvedPath = await realpath(absolutePath);
  if (resolvedPath !== absolutePath) {
    throw new Error(`Deployment source files must not be symbolic links: ${displayPath}`);
  }
  const initial = await lstat(absolutePath);
  if (!initial.isFile() || initial.isSymbolicLink()) {
    throw new Error(`Deployment source entry is not a regular file: ${displayPath}`);
  }
  if (initial.size > DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceFileBytes) {
    throw new Error(`Deployment source file exceeds its byte limit: ${displayPath}`);
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== initial.size) {
      throw new Error(`Deployment source file changed while being read: ${displayPath}`);
    }
    return Object.freeze({
      path: displayPath,
      bytes: new Uint8Array(await handle.readFile()),
    });
  } finally {
    await handle.close();
  }
}

function gitOutput(projectRoot: string, arguments_: readonly string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...arguments_],
      { cwd: projectRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? undefined : stdout.trim()),
    );
  });
}

async function sourceRevision(
  projectRoot: string,
): Promise<DeploymentBundleSourceSnapshot['revision']> {
  const [commit, branch] = await Promise.all([
    gitOutput(projectRoot, ['rev-parse', 'HEAD']),
    currentGitBranch(projectRoot),
  ]);
  if (!commit || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) return undefined;
  const status = await gitOutput(projectRoot, ['status', '--porcelain', '--untracked-files=all']);
  if (status === undefined) return undefined;
  return Object.freeze({
    kind: 'git',
    commit,
    dirty: status.length > 0,
    ...(branch ? { branch } : {}),
  });
}

export async function captureDeploymentSourceSnapshot(
  apiPath: string,
): Promise<DeploymentBundleSourceSnapshot> {
  const projectRoot = await realpath(process.cwd());
  const entrypointAbsolute = await realpath(path.resolve(projectRoot, apiPath));
  const entrypoint = portableProjectPath(projectRoot, entrypointAbsolute);
  let inputs: readonly string[];
  try {
    const result = await build({
      absWorkingDir: projectRoot,
      bundle: true,
      entryPoints: [entrypointAbsolute],
      logLevel: 'silent',
      metafile: true,
      packages: 'external',
      platform: 'node',
      sourcemap: false,
      tsconfig: await findNearestTsconfig(entrypointAbsolute) ?? undefined,
      write: false,
    });
    inputs = Object.keys(result.metafile.inputs);
  } catch (error) {
    throw new Error(
      `Could not resolve the deployment source graph from ${apiPath}.\n`
      + `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const paths = [...new Set(inputs.map(input => {
    const absolute = path.resolve(projectRoot, input);
    const relative = portableProjectPath(projectRoot, absolute);
    if (relative.split('/').includes('node_modules')) {
      throw new Error(`Deployment source graph unexpectedly included a dependency: ${relative}`);
    }
    return relative;
  }))].sort();
  if (!paths.includes(entrypoint)) paths.unshift(entrypoint);
  if (paths.length > DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceFiles) {
    throw new Error('Deployment source graph exceeds the bundle file limit.');
  }

  const files = await Promise.all(paths.map(file => readSourceFile(projectRoot, file)));
  const totalBytes = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (totalBytes > DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceBytes) {
    throw new Error('Deployment source graph exceeds the bundle byte limit.');
  }
  const revision = await sourceRevision(projectRoot);
  return Object.freeze({
    entrypoint,
    files: Object.freeze(files),
    ...(revision ? { revision } : {}),
  });
}
