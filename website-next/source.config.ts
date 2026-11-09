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
  },
});

export default defineConfig();
