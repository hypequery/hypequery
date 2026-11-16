import { absoluteUrl } from '@/lib/site';
import {
  entryHref,
  kindLabel,
  kindPath,
  readmeBody,
  relatedEntries,
  REPO_TREE_URL,
  type RegistryEntry,
} from '@/lib/examples';

/**
 * The Markdown twin of an example or recipe page. Same content as the HTML
 * page, in the order agents read best: where you are, what this is, how to
 * run it, the code, then where to go next.
 */
export function entryMarkdown(entry: RegistryEntry): string {
  const { manifest } = entry;
  const hub = kindLabel(manifest.kind, true);
  const url = absoluteUrl(entryHref(entry)).toString();
  const lines: string[] = [
    `[hypequery](${absoluteUrl('/').toString()}) › [${hub}](${absoluteUrl(kindPath(manifest.kind)).toString()}) › ${manifest.title}`,
    `Index for agents: ${absoluteUrl('/llms.txt').toString()}`,
    '',
    `# ${manifest.title} (${url})`,
    '',
    manifest.outcome,
    '',
  ];
  if (manifest.kind === 'guide') {
    lines.push(
      `Runs on ClickHouse ${manifest.clickhouseVersion}. Every SQL block below is a file CI runs against the seed dataset: ${REPO_TREE_URL}/${entry.dir}`,
      '',
    );
  } else {
    lines.push(
      '## Run it',
      '',
      '```bash',
      `npx @hypequery/cli create ${manifest.slug} -y`,
      `cd ${manifest.slug}`,
      manifest.run.install,
      manifest.run.dev,
      '```',
      '',
      `- Packages: ${manifest.packages.join(', ')} (hypequery ${manifest.minVersion} or later)`,
      `- Stack: ${manifest.stack.join(', ')}`,
      `- Source: ${REPO_TREE_URL}/${entry.dir}`,
      `- Test: \`${manifest.run.test}\``,
    );
    if (manifest.exampleRequest) lines.push(`- Verify: \`${manifest.exampleRequest}\``);
    if (manifest.env.length > 0) {
      lines.push('', '| Env var | Required | Description |', '| --- | --- | --- |');
      for (const v of manifest.env) lines.push(`| ${v.name} | ${v.required ? 'yes' : 'no'} | ${v.description.replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('', readmeBody(entry).replace(/\]\((\/[^)]+)\)/g, (_m, p: string) => `](${absoluteUrl(p).toString()})`));
  if (entry.keyFile) {
    lines.push('', `## Key file: ${entry.keyFile.path}`, '', `\`\`\`${entry.keyFile.language}`, entry.keyFile.source.trimEnd(), '```');
  }
  if (entry.recipe) {
    lines.push(
      '',
      `## Dataset: ${entry.recipe.dataset.path}`,
      '',
      `\`\`\`${entry.recipe.dataset.language}`,
      entry.recipe.dataset.source.trimEnd(),
      '```',
      '',
      '## Generated SQL',
      '',
      '```sql',
      entry.recipe.expectedSql.trimEnd(),
      '```',
      '',
      '## Output on the seed dataset',
      '',
      '```json',
      entry.recipe.output.trimEnd(),
      '```',
    );
  }
  const related = relatedEntries(entry);
  lines.push('', '## Related', '');
  for (const item of related) lines.push(`- [${item.manifest.title}](${absoluteUrl(entryHref(item)).toString()}): ${item.manifest.outcome}`);
  lines.push(`- [All ${hub.toLowerCase()}](${absoluteUrl(kindPath(manifest.kind)).toString()})`);
  for (const page of manifest.leadPages) lines.push(`- [${page}](${absoluteUrl(page).toString()})`);
  return `${lines.join('\n').trim()}\n`;
}

export function markdownResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // X-Robots-Tag and the canonical Link are set by src/proxy.ts and next.config.ts,
      // which know whether the twin was asked for by suffix or at the page's own URL.
    },
  });
}

export function markdownNotFound(pathname: string): Response {
  return markdownResponse(`# Not found\n\nThere is no page at ${pathname}. Start from ${absoluteUrl('/llms.txt').toString()}.\n`, 404);
}
