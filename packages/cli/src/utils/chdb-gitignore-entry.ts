import path from 'node:path';

export function getChdbGitignoreEntry(chdbPath: string | undefined, cwd: string): string | undefined {
  if (!chdbPath || /[\0\r\n]/.test(chdbPath)) {
    return undefined;
  }

  cwd = path.resolve(cwd);
  const relativePath = path.relative(cwd, path.resolve(cwd, chdbPath));
  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return undefined;
  }

  const normalizedPath = relativePath.split(path.sep).join('/');
  const escapedPath = normalizedPath.replace(/[\\*?[\]]/g, '\\$&');
  return `/${escapedPath}/`;
}

