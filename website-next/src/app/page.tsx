import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import { softwareApplicationSchema } from '@/data/product';
import { getPostBySlug } from '@/lib/blog-cms';
import { getNpmDownloadCounts } from '@/lib/npm-downloads';
import { createCommand, examples, recipes } from '@/lib/examples';
import type { ExamplePickerOption } from '@/components/home/ExamplePicker';
import { AnnouncementBanner, Hero, FinalCTA } from '@/components/home';
import { FeatureGrid } from '@/components/home/FeatureGrid';
import { ProductExplainer } from '@/components/home/ProductExplainer';
import { PatternCallout } from '@/components/home/PatternCallout';
import { CloudWorkflow } from '@/components/home/CloudWorkflow';
import { RunsWhereYourAppRuns } from '@/components/home/RunsWhereYourAppRuns';
import { StaticCode } from '@/components/home/StaticCode';

// The definition behind the explainer diagram: orders, scoped by tenant, joined to customers.
const MODEL_CODE = `
export const orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  dimensions: {
    country: dimension.string(),
    plan: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
  relationships: {
    customer: belongsTo(() => customers, {
      from: 'customer_id',
      to: 'id',
    }),
  },
});
`;

// The React side of the explainer's dashboard card.
const DASHBOARD_CODE = `
import { useDataset } from '@/lib/analytics';

export function RevenueByCountry() {
  const { data, isLoading } =
    useDataset('orders', {
      dimensions: ['country'],
      measures: ['revenue'],
      limit: 3,
    });

  if (isLoading) return <Skeleton />;
  return <BarList rows={data?.data} />;
}
`;

const softwareSchema = {
  '@context': 'https://schema.org',
  ...softwareApplicationSchema,
};

// The banner links here, so it shows only once the post is published.
const LAUNCH_POST_SLUG = 'introducing-hypequery-python';

// Built here, not in the client hero, so the registry's README bodies stay out of the bundle.
const exampleOptions: ExamplePickerOption[] = [...examples, ...recipes].flatMap((entry) => {
  const command = createCommand(entry);
  const { manifest } = entry;
  return command && manifest.kind !== 'guide' ? [{ slug: manifest.slug, kind: manifest.kind, language: manifest.language, command }] : [];
});

export default async function Home() {
  const [launchPost, npmDownloads] = await Promise.all([getPostBySlug(LAUNCH_POST_SLUG), getNpmDownloadCounts()]);

  return (
    <div className="min-h-screen bg-bg text-text">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />
      {launchPost && <AnnouncementBanner href={`/blog/${LAUNCH_POST_SLUG}`} />}
      <Navigation hasBanner={Boolean(launchPost)} />
      <main className={launchPost ? 'pt-[104px]' : 'pt-[62px]'}>
        <Hero npmDownloads={npmDownloads} exampleOptions={exampleOptions} />
        <PatternCallout />
        {/* Hero (what it is) → proof → every interface (what it powers) → runs in your stack (where it lives)
            → production features (can I trust it) → change safely (what happens next) → CTA.
            BuildYourWay (model in code or in cloud) is off the page until cloud launches. */}
        <ProductExplainer
          modelCode={<StaticCode code={MODEL_CODE} />}
          dashboardCode={<StaticCode code={DASHBOARD_CODE} lang="tsx" className="text-[10.5px]!" />}
        />
        <RunsWhereYourAppRuns />
        <FeatureGrid />
        <CloudWorkflow />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
