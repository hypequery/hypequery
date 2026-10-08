import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import { absoluteUrl } from '@/lib/site';
import { AnnouncementBanner, Hero, FinalCTA } from '@/components/home';
import { FeatureGrid } from '@/components/home/FeatureGrid';
import { DatasetQuickstart } from '@/components/home/DatasetQuickstart';
import { ProductExplainer } from '@/components/home/ProductExplainer';
import { PatternCallout } from '@/components/home/PatternCallout';
import { AiAuthoring } from '@/components/home/AiAuthoring';

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': absoluteUrl('/#software').toString(),
  name: 'hypequery',
  url: absoluteUrl('/').toString(),
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Cross-platform',
  description:
    'Ship AI analytics on ClickHouse. Analytics as code: define measures once, and AI agents, chat, and dashboards answer from the same governed definitions.',
  softwareVersion: 'latest',
  codeRepository: 'https://github.com/hypequery/hypequery',
  programmingLanguage: ['TypeScript', 'Python'],
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  softwareHelp: absoluteUrl('/docs/introduction').toString(),
  downloadUrl: 'https://www.npmjs.com/package/@hypequery/clickhouse',
  author: { '@id': absoluteUrl('/#organization').toString() },
  publisher: { '@id': absoluteUrl('/#organization').toString() },
};

export default function Home() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />
      <AnnouncementBanner />
      <Navigation hasBanner />
      <main className="pt-[104px]">
        <Hero />
        <ProductExplainer />
        <PatternCallout />
        <AiAuthoring />
        <FeatureGrid />
        <DatasetQuickstart />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
