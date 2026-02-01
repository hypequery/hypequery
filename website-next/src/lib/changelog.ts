import fs from 'fs';
import path from 'path';

export interface ChangelogEntry {
  version: string;
  body: string;
}

export async function getChangelogEntries(): Promise<ChangelogEntry[]> {
  const changelogPath = path.join(process.cwd(), '../packages/clickhouse/CHANGELOG.md');
  const content = fs.readFileSync(changelogPath, 'utf-8');

  const normalized = content.replace(/\r/g, '').trim();

  // Match version sections like ## [1.5.0]
  const matches = Array.from(
    normalized.matchAll(/##\s+\[(.*?)\](.*?)(?=(\n##\s+\[)|$)/gs)
  );

  return matches.map((match) => ({
    version: match[1],
    body: match[2].trim(),
  }));
}
