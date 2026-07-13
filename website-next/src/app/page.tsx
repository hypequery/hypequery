import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import { absoluteUrl } from '@/lib/site';
import {
  AnnouncementBanner,
  Hero,
  Quickstart,
  DefineOnce,
  Capabilities,
  Stack,
  UseCases,
  FinalCTA,
} from '@/components/home';

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'hypequery',
  url: absoluteUrl('/').toString(),
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Node.js',
  description:
    'The TypeScript analytics layer for ClickHouse. Define queries, metrics, and dimensions once, then expose them as typed APIs, React hooks, or MCP tools.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  softwareHelp: absoluteUrl('/docs/introduction').toString(),
  downloadUrl: 'https://www.npmjs.com/package/@hypequery/clickhouse',
  author: { '@id': absoluteUrl('/#organization').toString() },
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
        <Quickstart />
        <DefineOnce />
        <Capabilities />
        <Stack />
        <UseCases />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
