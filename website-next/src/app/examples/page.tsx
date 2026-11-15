import type { Metadata } from 'next';
import ExamplesHub from '@/components/examples/ExamplesHub';
import { examples } from '@/lib/examples';
import { absoluteUrl, ogImage } from '@/lib/site';

const title = 'hypequery examples: runnable ClickHouse analytics apps';
const description =
  'Runnable ClickHouse examples in TypeScript and Python: FastAPI, Django and Streamlit apps, dashboards, materialized views and multi-tenant analytics.';

export const metadata: Metadata = {
  title: 'ClickHouse Examples in TypeScript and Python',
  description,
  // Facet filters live in the query string; the canonical is always the hub.
  alternates: { canonical: absoluteUrl('/examples') },
  openGraph: { type: 'website', url: absoluteUrl('/examples'), title, description, images: ogImage('hypequery examples') },
  twitter: { card: 'summary_large_image', title, description },
};

export default function ExamplesPage() {
  return (
    <ExamplesHub
      kind="example"
      eyebrow="Examples"
      title="Runnable ClickHouse examples you can scaffold in one command"
      lead="Each example is a small, complete app over the same seeded SaaS dataset. Read the key file on the page, scaffold it with the CLI, and run its smoke test against your own ClickHouse."
      entries={examples}
      emptyCopy="Examples are being added. Check back soon."
    />
  );
}
