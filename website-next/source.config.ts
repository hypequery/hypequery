import { defineDocs, defineConfig, frontmatterSchema } from 'fumadocs-mdx/config';
import { z } from 'zod';
import { execFileSync } from 'node:child_process';

// A shallow clone (Vercel's default) shows every file as added in its oldest commit, which
// would date untouched docs to that commit. Only read dates from a full history; set
// VERCEL_DEEP_CLONE=true on Vercel to get them there.
const fullGitHistory = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'false';
  } catch {
    return false;
  }
})();

async function gitLastModified(filePath: string): Promise<Date | undefined> {
  if (!fullGitHistory) return undefined;
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%aI', '--', filePath], { encoding: 'utf8' }).trim();
    return iso ? new Date(iso) : undefined;
  } catch {
    return undefined;
  }
}

export const docs = defineDocs({
  dir: 'docs',
  docs: {
    schema: frontmatterSchema.extend({
      // The `<title>` and social title, when the nav label ("Overview", "Quick Start") is too short to stand on
      // its own in search results and AI answers. The sidebar and H1 keep `title`.
      seoTitle: z.string().optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
    // Each page's last Git commit, for the docs sitemap <lastmod> and the page's dateModified.
    lastModified: gitLastModified,
  },
});

export default defineConfig();
