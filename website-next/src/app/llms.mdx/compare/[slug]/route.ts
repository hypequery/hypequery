import { notFound } from 'next/navigation';
import { compareMarkdown, getCompareArticle } from '@/lib/compare-article';
import { comparePageBySlug, comparePages } from '@/data/compare-pages';

export const revalidate = false;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = comparePageBySlug[slug as keyof typeof comparePageBySlug];
  if (!page) notFound();

  const article = await getCompareArticle(slug);
  if (!article) notFound();

  return new Response(compareMarkdown(page, article), {
    headers: {
      'Content-Type': 'text/markdown',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export function generateStaticParams() {
  return comparePages.map((page) => ({ slug: page.slug }));
}
