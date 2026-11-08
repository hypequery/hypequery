import type { Metadata } from 'next';
import ExamplesHub from '@/components/examples/ExamplesHub';
import { guides } from '@/lib/examples';
import { absoluteUrl, ogImage } from '@/lib/site';

const title = 'hypequery guides: ClickHouse patterns with SQL that runs in CI';
const description =
  'Long-form ClickHouse guides, each with SQL that is executed against a seeded dataset on every change: refreshable materialized views and more.';

export const metadata: Metadata = {
  title: 'Guides',
  description,
  alternates: { canonical: absoluteUrl('/guides') },
  openGraph: { type: 'website', url: absoluteUrl('/guides'), title, description, images: ogImage('hypequery guides') },
  twitter: { card: 'summary_large_image', title, description },
};

export default function GuidesPage() {
  return (
    <ExamplesHub
      kind="guide"
      eyebrow="Guides"
      title="ClickHouse guides whose SQL has already run"
      lead="Each guide teaches one ClickHouse capability end to end. Every SQL block is a file that CI runs against the seed dataset on the pinned ClickHouse version, so the statements on the page are the statements that worked."
      entries={guides}
      emptyCopy="Guides are being added."
    />
  );
}
