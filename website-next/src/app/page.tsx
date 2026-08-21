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
  '@id': absoluteUrl('/#software').toString(),
  name: 'hypequery',
  url: absoluteUrl('/').toString(),
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Cross-platform',
  description:
    'Define ClickHouse metrics once in TypeScript, then reuse them across APIs, jobs, dashboards, and AI agents.',
  softwareVersion: 'latest',
  codeRepository: 'https://github.com/hypequery/hypequery',
  programmingLanguage: 'TypeScript',
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
