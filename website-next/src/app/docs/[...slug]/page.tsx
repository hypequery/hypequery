import type { Metadata } from 'next';
import Link from 'next/link';
import { source } from '@/lib/meta';
import {
  DocsPage,
  DocsBody,
  DocsDescription,
  DocsTitle,
} from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { LLMCopyButton, ViewOptions } from '@/components/page-actions';
import { getCanonicalUrl } from '@/lib/seo';
import StructuredData from '@/components/StructuredData';
import Breadcrumbs from '@/components/Breadcrumbs';

function formatSegmentLabel(segment: string) {
  return segment
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) {
    return {};
  }

  const canonical = getCanonicalUrl(page.url);

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      canonical,
    },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url: canonical,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: page.data.title,
      description: page.data.description,
    },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const Body = page.data.body;
  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Docs', href: '/docs' },
    ...slug.slice(0, -1).map((segment, index) => ({
      label: formatSegmentLabel(segment),
      href: `/docs/${slug.slice(0, index + 1).join('/')}`,
    })),
    { label: page.data.title },
  ];
  const sectionLabel = slug.length > 1 ? formatSegmentLabel(slug[0]) : 'Documentation';
  const breadcrumbStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbItems.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: getCanonicalUrl(item.href ?? page.url).toString(),
    })),
  };

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      className="docs-page-shell pt-10 md:pt-12 xl:pt-16"
      tableOfContent={{ style: 'clerk' }}
      footer={{ enabled: true }}
    >
      <StructuredData data={breadcrumbStructuredData} />
      <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/docs" className="text-indigo-300 hover:text-indigo-200">
            Back to docs home
          </Link>
          <span className="text-slate-500">/</span>
          <span className="text-slate-300">{sectionLabel}</span>
        </div>
        <Breadcrumbs items={breadcrumbItems} className="mt-4" />
        <DocsTitle className="mt-5">{page.data.title}</DocsTitle>
        <DocsDescription className="mb-0 mt-3">{page.data.description}</DocsDescription>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
          <LLMCopyButton markdownUrl={`${page.url}.mdx`} />
          <ViewOptions
            markdownUrl={`${page.url}.mdx`}
            githubUrl={`https://github.com/hypequery/hypequery/blob/main/website-next/docs/${page.path}`}
          />
        </div>
      </div>
      <div className="docs-body-shell">
        <DocsBody>
          <Body />
        </DocsBody>
      </div>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}
