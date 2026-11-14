import type { Metadata } from 'next';
import ExamplesHub from '@/components/examples/ExamplesHub';
import { recipes } from '@/lib/examples';
import { absoluteUrl, ogImage } from '@/lib/site';

const title = 'hypequery recipes: one ClickHouse question, one typed dataset, the SQL it generates';
const description =
  'ClickHouse recipes for p95 latency, retention cohorts, funnels, sessions and top-N per group: the dataset, the generated SQL and the output on seed data.';

export const metadata: Metadata = {
  title: 'ClickHouse Recipes: Analytics Queries with Their SQL',
  description,
  alternates: { canonical: absoluteUrl('/recipes') },
  openGraph: { type: 'website', url: absoluteUrl('/recipes'), title, description, images: ogImage('hypequery recipes') },
  twitter: { card: 'summary_large_image', title, description },
};

export default function RecipesPage() {
  return (
    <ExamplesHub
      kind="recipe"
      eyebrow="Recipes"
      title="One ClickHouse question, one typed dataset, and the SQL it generates"
      lead="Recipes are smaller than examples: a dataset definition, the exact SQL hypequery produces for one question, and the answer on the seed data, all asserted in CI."
      entries={recipes}
      emptyCopy="The first recipes (p95 latency, retention cohorts) are on their way."
    />
  );
}
