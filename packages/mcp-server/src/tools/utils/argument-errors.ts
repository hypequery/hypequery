import type { z } from 'zod';

type Issue = z.core.$ZodIssue;

/**
 * Tool argument issues as `path: message` lines an agent can correct from.
 *
 * An exact query schema is a union with one branch per dataset (and a filter is
 * a union with one branch per field), so Zod reports a bare "Invalid input" with
 * every branch's issues nested. This reports the branch the call was aimed at
 * instead: the one whose literals (`dataset`, a filter's `field`) it matched.
 * When no branch matches on a literal, it names the literal and every value
 * the branches offer. It never repeats a submitted value: an unknown key's name
 * is submitted data too, so it is reported without its name.
 */
export function formatArgumentIssues(issues: readonly Issue[], at: readonly PropertyKey[] = []): string[] {
  return issues.flatMap(issue => {
    const path = [...at, ...issue.path];
    if (issue.code === 'invalid_union' && issue.errors.length > 0) return formatUnion(issue.errors, path);
    if (issue.code === 'unrecognized_keys') return [`${pathOf(path)}: has a key this tool does not accept`];
    return [`${pathOf(path)}: ${issue.message}`];
  });
}

function formatUnion(branches: readonly (readonly Issue[])[], at: readonly PropertyKey[]): string[] {
  // A branch "misses" when the call does not match one of its literals: it was
  // aimed at another dataset or field. The branch with no misses is the target.
  const misses = branches.map(branch => branch.filter(isLiteralMiss));
  const fewest = Math.min(...misses.map(miss => miss.length));
  if (fewest === 0) {
    const aimed = branches.filter((_, index) => misses[index].length === 0);
    const closest = aimed.reduce((best, branch) => (branch.length < best.length ? branch : best));
    return formatArgumentIssues(closest, at);
  }
  // Every branch missed. A literal every branch missed is the one to fix.
  const shared = misses[0].filter(issue => misses.every(miss => miss.some(other => samePath(other, issue))));
  if (shared.length > 0) {
    return shared.map(issue => {
      const values = [...new Set(misses.flatMap(miss => miss.filter(other => samePath(other, issue)).flatMap(valuesOf)))];
      return `${pathOf([...at, ...issue.path])}: expected one of ${values.map(value => JSON.stringify(value)).join(', ')}`;
    });
  }
  const closest = branches.reduce((best, branch) => (branch.length < best.length ? branch : best));
  return formatArgumentIssues(closest, at);
}

/** A mismatched literal directly on the branch's object: `dataset`, `metric`, `field`, `operator`. */
function isLiteralMiss(issue: Issue): boolean {
  return issue.code === 'invalid_value' && issue.path.length === 1;
}

function valuesOf(issue: Issue): unknown[] {
  return issue.code === 'invalid_value' ? [...issue.values] : [];
}

function samePath(left: Issue, right: Issue): boolean {
  return left.path.map(String).join('.') === right.path.map(String).join('.');
}

function pathOf(path: readonly PropertyKey[]): string {
  return path.length > 0 ? path.map(String).join('.') : 'arguments';
}
