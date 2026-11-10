import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PageWrapper from '@/components/PageWrapper';
import ExampleDetail from '@/components/examples/ExampleDetail';
import { getEntry, guides } from '@/lib/examples';
import { absoluteUrl, ogImage } from '@/lib/site';

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return guides.map((entry) => ({ slug: entry.manifest.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entry = getEntry('guide', slug);
  if (!entry) return {};
  const url = absoluteUrl(`/guides/${slug}`);
  const title = entry.manifest.title;
  const description = entry.manifest.outcome;
  return {
    title,
    description,
    keywords: entry.manifest.keywords,
    alternates: {
      canonical: url,
      types: { 'text/markdown': absoluteUrl(`/guides/${slug}.md`).toString() },
    },
    openGraph: { type: 'article', url, title, description, images: ogImage(title) },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function GuideDetailPage({ params }: Props) {
  const { slug } = await params;
  const entry = getEntry('guide', slug);
  if (!entry) notFound();
  return (
    <PageWrapper>
      <ExampleDetail entry={entry} />
    </PageWrapper>
  );
}
