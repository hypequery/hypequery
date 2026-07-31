// Renders a run summary for humans or machines.
import type { RunSummary } from './types.js';

export function formatJsonReport(summary: RunSummary): string {
  return JSON.stringify(summary, null, 2);
}

export function formatPrettyReport(summary: RunSummary): string {
  const lines: string[] = [];
  const adapter = summary.adapter;
  const label = adapter?.implementation
    ? `${adapter.implementation}${adapter.version ? `@${adapter.version}` : ''}`
    : 'adapter';
  lines.push(`Conformance run against ${label}${adapter?.language ? ` (${adapter.language})` : ''}`);

  for (const outcome of summary.outcomes) {
    if (outcome.status === 'pass') continue;
    const mark = outcome.status === 'skip' ? 'SKIP' : 'FAIL';
    const detail = [outcome.expected ? `expected ${outcome.expected}` : '', outcome.actual ? `got ${outcome.actual}` : '', outcome.message ?? '']
      .filter(Boolean)
      .join(', ');
    lines.push(`  ${mark} ${outcome.family}/${outcome.role}/${outcome.id}${detail ? ` — ${detail}` : ''}`);
  }

  lines.push(
    `${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`
    + (summary.notRun > 0 ? `, ${summary.notRun} not run (family not announced)` : ''),
  );
  // RFC 0012 requires the declaration from implementations that accept host
  // values; adapters announcing only text-input families are exempt.
  const suite = adapter?.hostileObjectSuite;
  if (suite) {
    lines.push(`hostile-object suite: ${suite.count} cases (${suite.mechanisms.join(', ')})`);
  } else if (adapter?.families.includes('tagged-values-v1')) {
    lines.push('hostile-object suite: none declared (required by RFC 0012)');
  }
  return lines.join('\n');
}
