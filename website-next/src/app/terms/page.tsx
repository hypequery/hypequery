import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';
import { updatedFor } from '@/data/page-dates';
import { absoluteUrl, ogImage } from '@/lib/site';

const PATH = '/terms';
const UPDATED = updatedFor(PATH);
const DESCRIPTION = 'The terms for using hypequery Cloud during its closed beta.';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    images: ogImage('Terms of service'),
    type: 'website',
    url: absoluteUrl(PATH),
    title: 'Terms of service | hypequery',
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: 'Terms of service | hypequery', description: DESCRIPTION },
};

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Legal" title="Terms of service" updated={UPDATED}>
      <p>
        These terms are an agreement between you (or the organisation you sign up for) and <strong>[LEGAL ENTITY]</strong>,
        [REGISTERED ADDRESS] (&quot;hypequery&quot;, &quot;we&quot;), for using hypequery Cloud at app.hypequery.com
        (the &quot;service&quot;). By creating an account or using the service, you accept them. If you sign up for an
        organisation, you confirm you can bind it to these terms.
      </p>
      <p>
        The open-source hypequery libraries are covered by their own licence (Apache 2.0), not by these terms.
      </p>

      <h2>1. Closed beta</h2>
      <p>
        hypequery Cloud is in closed beta. Access is by invitation, and we can decline or end it. Features, limits and
        pricing will change. We may change or withdraw any part of the service, or the whole service. We will give you
        reasonable notice where we can so you can export what you need.
      </p>

      <h2>2. Your account</h2>
      <p>
        Keep your sign-in email, API keys and deploy keys secure. You are responsible for what happens under your account
        and keys, and for the people you invite to your organisation. Tell us at [CONTACT EMAIL] if you think an account
        or key has been misused.
      </p>

      <h2>3. Your data</h2>
      <p>
        You own your data: your ClickHouse data, your semantic models, and what you type into the service. You give us
        permission to process it only to run the service for you, as our <Link href="/privacy">privacy policy</Link>{' '}
        describes. You are responsible for having the right to connect the databases you connect and to let us query
        them. Connect a read-only ClickHouse user where you can.
      </p>

      <h2>4. Acceptable use</h2>
      <p>Do not use the service to:</p>
      <ul>
        <li>break the law, or infringe anyone&apos;s rights;</li>
        <li>connect databases or process data you are not authorised to use;</li>
        <li>attack, probe or overload the service or other customers, or get around its limits or security;</li>
        <li>use the AI assistant in breach of Anthropic&apos;s usage policies;</li>
        <li>resell the service, or copy it to build a competing product.</li>
      </ul>
      <p>We may suspend access that breaks these rules or puts the service or other customers at risk.</p>

      <h2>5. Limits and fair use</h2>
      <p>
        The beta trial includes set allowances (query executions, AI credit, projects and seats), shown in the app. When
        you reach one, the related feature stops until your allowance changes. Separately from plan allowances, we apply
        rate and fair-use limits to keep the service reliable for everyone, and may lower them for usage that harms it.
      </p>

      <h2>6. Paid plans</h2>
      <p>
        If you subscribe to a paid plan, you pay the prices shown at checkout. Stripe processes payments. Subscriptions
        renew until you cancel them in the billing portal; cancelling takes effect at the end of the paid period. Fees are
        non-refundable except where the law requires otherwise.
      </p>

      <h2>7. AI features</h2>
      <p>
        The assistant can be wrong. Check its answers, models and queries before relying on them. You are responsible
        for what you publish or act on.
      </p>

      <h2>8. No warranty</h2>
      <p>
        The service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, including
        fitness for a particular purpose, availability, or accuracy of results. Beta services may have bugs, outages and
        data loss. Keep your own copies of anything important.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the extent the law allows, hypequery is not liable for indirect or consequential losses, lost profits, lost
        revenue or lost data. Our total liability for all claims about the service is limited to the greater of what you
        paid us in the 12 months before the claim and [LIABILITY CAP AMOUNT]. Nothing in these terms limits liability that
        cannot be limited by law, such as for fraud or for death or personal injury caused by negligence.
      </p>

      <h2>10. Ending the agreement</h2>
      <p>
        You can stop using the service at any time; to close your account, email [CONTACT EMAIL]. We may end or suspend
        your access if you break these terms, or when the beta or the service ends, with notice where we can. When the
        agreement ends, your access stops and we delete your data as the privacy policy describes. Sections 3, 8, 9 and
        12 continue to apply.
      </p>

      <h2>11. Changes to these terms</h2>
      <p>
        We may update these terms. We will change the date above, and tell account holders by email about significant
        changes before they apply. Continuing to use the service after that means you accept the new terms.
      </p>

      <h2>12. Governing law</h2>
      <p>These terms are governed by [GOVERNING LAW], and the courts of [JURISDICTION] have jurisdiction.</p>

      <h2>13. Contact</h2>
      <p>Questions about these terms: [CONTACT EMAIL].</p>
    </LegalPage>
  );
}
