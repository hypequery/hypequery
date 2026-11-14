import type { Metadata } from 'next';
import Link from 'next/link';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

// RE-VERIFY QUARTERLY. Every ClickHouse Cloud figure below comes from clickhouse.com/pricing
// (AWS us-east-1, list prices). Re-check them, update VERIFIED_ON and this page's date in
// src/data/page-dates.ts. Next check due: February 2027.
const PATH = '/clickhouse-cloud-pricing';
const TITLE = 'ClickHouse Cloud Pricing (2026): Costs and Worked Examples';
const DESCRIPTION =
  'ClickHouse Cloud bills compute per minute at $0.2181-$0.3903 per unit-hour and storage at $25.30 per TB-month. Plans, worked monthly costs and alternatives.';
const PUBLISHED = '2026-11-14';
const UPDATED = updatedFor(PATH);
const VERIFIED_ON = 'November 14, 2026';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: TITLE,
    description: DESCRIPTION,
    images: ogImage('ClickHouse Cloud pricing'),
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const extLink = 'underline decoration-border-strong underline-offset-4 hover:text-accent';

const PRICING_URL = 'https://clickhouse.com/pricing';

const planRows = [
  ['Basic', '$0.2181', '$25.30', 'Up to 1 TB storage, 8–12 GiB total memory, 1 availability zone, daily backups kept 1 day', 'Testing ideas and starter projects'],
  ['Scale', '$0.2985', '$25.30', 'Unlimited storage, configurable memory, 2+ availability zones, compute-compute separation, private networking, automatic vertical scaling', 'Production workloads'],
  ['Enterprise', '$0.3903', '$25.30', 'Everything in Scale plus SAML SSO, private regions, CMEK, scheduled upgrades, HIPAA and PCI compliance', 'Very large or regulated workloads'],
];

const exampleRows = [
  ['One Basic compute unit running all month', '730 hours × $0.2181', 'about $159', 'The always-on floor for the smallest service'],
  ['One Basic compute unit used 8 hours a day on 22 working days', '176 hours × $0.2181', 'about $38', 'Assumes the service idles to zero the rest of the time; idling starts after a period of inactivity'],
  ['One Scale compute unit running all month', '730 hours × $0.2985', 'about $218 per unit', 'Scale runs across 2+ availability zones, so check how many units your service provisions'],
  ['One Enterprise compute unit running all month', '730 hours × $0.3903', 'about $285 per unit', 'Same caveat on unit count'],
  ['Storage for 1 TB of raw data', '~100 GB compressed (ClickHouse cites ~10× compression) × $25.30 per TB', 'about $2.53', 'Plus backups at the same per-TB rate'],
];

const alternativeRows = [
  ['ClickHouse Cloud', 'Usage: compute-unit-hours plus storage', '$300 in credits for 30 days, then pay as you go', <Link key="mcs" href="/blog/managed-clickhouse-services-compared" className={extLink}>managed services compared</Link>],
  ['Tinybird', 'Plan sized in vCPUs plus overages', 'Free plan; Developer from $25/month', <Link key="tb" href="/compare/clickhouse-cloud-vs-tinybird" className={extLink}>ClickHouse Cloud vs Tinybird</Link>],
  ['Aiven for ClickHouse', 'Hourly rate per service plan', 'Developer tier $43/month', <Link key="ai" href="/blog/managed-clickhouse-services-compared" className={extLink}>managed services compared</Link>],
  ['Altinity.Cloud', 'Hourly per server and per vCPU, plus storage per GB, by provider and region', 'Free trial; rates from the calculator on its pricing page', <Link key="al" href="/blog/managed-clickhouse-services-compared" className={extLink}>managed services compared</Link>],
  ['Self-hosted ClickHouse', 'Open source (Apache 2.0)', 'No licence fee; you pay for servers and operations', <a key="oss" href="https://github.com/ClickHouse/ClickHouse" rel="noopener nofollow" className={extLink}>github.com/ClickHouse</a>],
];

const faqItems: FaqItem[] = [
  {
    question: 'How much does ClickHouse Cloud cost?',
    answer:
      'Compute is billed per minute in compute units of 8 GiB RAM and 2 vCPUs: on AWS us-east-1, $0.2181 per unit-hour on Basic, $0.2985 on Scale and $0.3903 on Enterprise. Storage is $25.30 per TB-month of compressed data on every plan. One Basic unit running all month is about $159 of compute. Prices checked on clickhouse.com/pricing on November 14, 2026.',
  },
  {
    question: 'Is there a free tier for ClickHouse Cloud?',
    answer:
      'There is a free trial rather than a free tier: every new organization gets $300 in credits for 30 days, then moves to pay as you go. The open-source ClickHouse distribution is free to self-host.',
  },
  {
    question: 'What is a ClickHouse Cloud compute unit?',
    answer:
      'One compute unit is 8 GiB of RAM and 2 vCPUs. Compute is metered per minute and billed per compute-unit-hour at the rate for your plan, cloud provider and region.',
  },
  {
    question: 'Does ClickHouse Cloud charge when the service is idle?',
    answer:
      'Not for compute: it scales down to zero after a period of inactivity and wakes on the next query or insert. Storage is billed continuously for the data you keep.',
  },
  {
    question: 'How is ClickHouse Cloud storage billed?',
    answer:
      'On the compressed size of your data in object storage, plus backups at the same per-TB rate. ClickHouse says analytical data typically compresses around 10×, so 1 TB of raw data is often billed as roughly 100 GB.',
  },
  {
    question: 'What else appears on a ClickHouse Cloud bill?',
    answer:
      'Backups, ClickPipes ingestion, and data transfer: public internet egress from $0.1152 per GB and inter-region egress from $0.0312 per GB. Ingress is free.',
  },
  {
    question: 'Is ClickHouse Cloud cheaper than Tinybird?',
    answer:
      'At the entry level, no: Tinybird has a free plan and a Developer plan from $25 a month (checked November 14, 2026), while one Basic ClickHouse Cloud unit running all month is about $159. A ClickHouse Cloud service that idles much of the day can cost less, and the two bill differently (compute minutes versus a plan sized in vCPUs), so compare on your own workload.',
  },
];

// Every vendor row was checked for this page on VERIFIED_ON; Altinity publishes rates only through its
// calculator, so its row describes the billing units rather than a figure.
const sources = [
  { vendor: 'ClickHouse', urls: [PRICING_URL] },
  { vendor: 'Tinybird', urls: ['https://www.tinybird.co/pricing'] },
  { vendor: 'Aiven', urls: ['https://aiven.io/clickhouse'] },
  { vendor: 'Altinity', urls: ['https://altinity.com/clickhouse-pricing/'] },
];

export default function ClickHouseCloudPricingPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'ClickHouse', href: '/clickhouse' },
        { label: 'ClickHouse Cloud pricing' },
      ]}
      eyebrow="Pricing"
      title="ClickHouse Cloud pricing in 2026: what it costs"
      updated={UPDATED}
      lead={
        <p>
          ClickHouse Cloud bills compute and storage separately. Compute is metered per minute in units of 8 GiB RAM and 2
          vCPUs, at $0.2181 per unit-hour on Basic, $0.2985 on Scale and $0.3903 on Enterprise (AWS us-east-1), and
          scales to zero when idle. Storage is $25.30 per TB-month of compressed data on every plan. One Basic unit
          running all month is about $159 of compute. New organizations get $300 in credits for 30 days. Every figure was
          checked on{' '}
          <a href={PRICING_URL} rel="noopener nofollow" className={inlineLink}>
            clickhouse.com/pricing
          </a>{' '}
          on {VERIFIED_ON}.
        </p>
      }
      primaryCta={{ href: '#examples', label: 'See worked examples', target: 'ch_pricing_examples' }}
      secondaryCta={{ href: '/blog/managed-clickhouse-services-compared', label: 'Compare managed services', target: 'ch_pricing_compare' }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        eyebrow="Plans"
        title="ClickHouse Cloud plans and prices"
        intro={
          <p>
            List prices for AWS us-east-1. Rates vary by cloud provider and region; storage is the same on every plan.
            Verified on {VERIFIED_ON}.
          </p>
        }
      >
        <HubTable
          caption={`ClickHouse Cloud plans, AWS us-east-1, verified ${VERIFIED_ON}`}
          columns={['Plan', 'Compute (per unit-hour)', 'Storage (per TB-month)', 'Includes', 'For']}
          rows={planRows}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">
          A compute unit is 8 GiB of RAM and 2 vCPUs, metered per minute. Data transfer is extra: public internet egress
          from $0.1152 per GB and inter-region egress from $0.0312 per GB; ingress is free. ClickPipes ingestion is priced
          by connector.
        </p>
      </HubSection>

      <HubSection
        id="examples"
        band
        eyebrow="Worked examples"
        title="What a month of ClickHouse Cloud costs"
        intro={
          <p>
            Compute dominates most bills, and whether a service idles decides how much of the month you pay for. These use
            the us-east-1 list rates and 730 hours a month. They are arithmetic on published prices, not quotes; the
            calculator on the pricing page rounds to the sizes you can actually provision.
          </p>
        }
      >
        <HubTable
          caption="ClickHouse Cloud monthly cost examples"
          columns={['Workload', 'Arithmetic', 'Monthly cost', 'Assumptions']}
          rows={exampleRows}
        />
      </HubSection>

      <HubSection
        eyebrow="Keeping it down"
        title="How to keep a ClickHouse Cloud bill down"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>Let services idle: compute scales to zero after inactivity, so intermittent workloads pay only for active minutes.</li>
            <li>Set a maximum autoscaling limit so an unexpected query load can’t grow compute without bound.</li>
            <li>Use Basic for development and testing; it is the cheapest rate and has the smallest limits.</li>
            <li>With compute-compute separation (Scale and Enterprise), several services share one copy of the data, so storage is billed once.</li>
            <li>Watch egress: serving query results to the public internet is billed per GB, while ingress is free.</li>
          </ul>
        }
      />

      <HubSection
        band
        eyebrow="Alternatives"
        title="ClickHouse Cloud vs other ways to run ClickHouse"
        intro={
          <p>
            Entry points from each vendor’s own pricing page, checked on {VERIFIED_ON}. For more on each, see our{' '}
            <Link href="/blog/managed-clickhouse-services-compared" className={inlineLink}>
              managed ClickHouse services comparison
            </Link>
            . They bill on different units, so compare on your workload, not the headline number.
          </p>
        }
      >
        <HubTable
          caption="Ways to run ClickHouse and their published entry points"
          columns={['Option', 'Pricing model', 'Entry point', 'More']}
          rows={alternativeRows}
        />
      </HubSection>

      <HubSection eyebrow="Using it" title="Building on ClickHouse Cloud">
        <div className={marketing.card}>
          <p className="text-sm leading-6 text-text-muted">
            hypequery runs on ClickHouse Cloud, self-hosted ClickHouse and chDB with the same code. It adds typed datasets,
            tenant-scoped APIs and MCP tools in your own TypeScript or Python backend, at no licence cost. See{' '}
            <Link href="/clickhouse-typescript" className={inlineLink}>
              the TypeScript client for ClickHouse Cloud
            </Link>{' '}
            and{' '}
            <Link href="/clickhouse-python" className={inlineLink}>
              ClickHouse Python clients
            </Link>
            .
          </p>
        </div>
      </HubSection>

      <HubSection band eyebrow="Questions" title="ClickHouse Cloud pricing FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
    </HubShell>
  );
}
