import { entryMarkdown, markdownNotFound, markdownResponse } from '@/lib/examples-markdown';
import { getEntry, examples } from '@/lib/examples';

// Static, regenerated at build time.
export const revalidate = false;

export function generateStaticParams() {
  return examples.map((entry) => ({ slug: entry.manifest.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = getEntry('example', slug);
  if (!entry) return markdownNotFound(`/examples/${slug}`);
  return markdownResponse(entryMarkdown(entry));
}
