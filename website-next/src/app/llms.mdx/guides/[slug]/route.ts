import { entryMarkdown, markdownNotFound, markdownResponse } from '@/lib/examples-markdown';
import { getEntry, guides } from '@/lib/examples';

// Static, regenerated at build time.
export const revalidate = false;

export function generateStaticParams() {
  return guides.map((entry) => ({ slug: entry.manifest.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = getEntry('guide', slug);
  if (!entry) return markdownNotFound(`/guides/${slug}`);
  return markdownResponse(entryMarkdown(entry));
}
