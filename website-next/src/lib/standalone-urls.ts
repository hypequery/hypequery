import { readdirSync } from 'node:fs';
import path from 'node:path';

const standaloneRoot = path.join(process.cwd(), 'docs/standalone-query-builder');

function collect(dir: string, segments: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const urls: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      urls.push(...collect(path.join(dir, entry.name), [...segments, entry.name]));
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      const slugParts = [...segments, entry.name.replace(/\.mdx$/, '')];
      const slug = slugParts.join('/');
      const suffix = slug === 'standalone-query-builder' ? '' : `/${slug}`;
      urls.push(`/docs/standalone-query-builder${suffix}`);
    }
  }
  return urls;
}

export const standaloneTabUrls = new Set(collect(standaloneRoot));
