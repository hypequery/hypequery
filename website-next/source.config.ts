import { defineDocs, defineConfig, frontmatterSchema } from 'fumadocs-mdx/config';
import { z } from 'zod';

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
    // Each page's last Git commit, for the docs sitemap <lastmod>. On a shallow clone,
    // pages outside the fetched history get no date; VERCEL_DEEP_CLONE=true fills them in.
    lastModified: true,
  },
});

export default defineConfig();
