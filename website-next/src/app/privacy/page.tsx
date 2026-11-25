import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';
import { updatedFor } from '@/data/page-dates';
import { absoluteUrl, ogImage } from '@/lib/site';

const PATH = '/privacy';
const UPDATED = updatedFor(PATH);
const DESCRIPTION =
  'What hypequery Cloud and hypequery.com collect, why, where it is stored, who processes it, how long it is kept, and your rights.';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    images: ogImage('Privacy policy'),
    type: 'website',
    url: absoluteUrl(PATH),
    title: 'Privacy policy | hypequery',
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: 'Privacy policy | hypequery', description: DESCRIPTION },
};

const subprocessors = [
  { name: 'Vercel', purpose: 'Hosting the app and this website', location: 'EU (Frankfurt) for the app' },
  { name: 'Neon', purpose: 'Postgres database for account, project and log data', location: 'EU (Frankfurt)' },
  { name: 'Amazon Web Services', purpose: 'Encryption keys (KMS) and running queries against your ClickHouse', location: 'EU (eu-central-1, Frankfurt)' },
  { name: 'Anthropic', purpose: 'The AI assistant: chat messages and schema context are sent to it', location: 'United States' },
  { name: 'Resend', purpose: 'Sign-in links and other transactional email', location: 'EU' },
  { name: 'PostHog', purpose: 'Product analytics in the app', location: 'EU (Frankfurt)' },
  { name: 'PostHog', purpose: 'Analytics on this website', location: 'United States' },
  { name: 'Google', purpose: 'Optional "Sign in with Google"; Google Analytics on this website, only with your consent', location: 'United States' },
  { name: 'Umami', purpose: 'Cookieless website analytics', location: 'EU' },
  { name: 'Leadfeeder', purpose: 'Identifying companies that visit this website, only with your consent', location: 'EU' },
];

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Legal" title="Privacy policy" updated={UPDATED}>
      <p>
        This policy explains what personal data hypequery (&quot;hypequery&quot;, &quot;we&quot;)
        collects when you use hypequery Cloud at app.hypequery.com and this website, hypequery.com. hypequery Cloud is in
        closed beta. We keep this page in line with how the product actually works, and update the date above when it
        changes.
      </p>
      <p>
        The open-source hypequery libraries run in your own infrastructure. They send us nothing, except optional,
        opt-out CLI usage telemetry described in the CLI docs.
      </p>

      <h2>Who we are</h2>
      <p>
        hypequery is run by <strong>Luke Reilly</strong>, a self-employed individual (autónomo) in Spain,
        trading as hypequery. Contact us about privacy at{' '}
        <a href="mailto:luke@hypequery.com">luke@hypequery.com</a>. When hypequery becomes a company, we will update this
        page to name it.
      </p>
      <p>
        For your account data and website data, we are the controller. For data we handle inside your ClickHouse
        database on your instructions (query results, schema, sample values), we act on your behalf as a processor.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account data.</strong> Your name and email address, and the organisations and projects you belong to.
          You sign in with an emailed link or, optionally, with Google. We do not store passwords.
        </li>
        <li>
          <strong>Project data.</strong> Organisation and project settings, your semantic models (datasets, measures,
          dimensions), releases, API and deploy keys (stored only as hashes), and an audit log of changes like
          publishes, role changes and sign-ins.
        </li>
        <li>
          <strong>ClickHouse connection details.</strong> Host, database, username and password. The password is
          encrypted with a key held in AWS KMS. It is only decrypted to run queries. It is never shown back to you, logged, or
          sent to the AI model.
        </li>
        <li>
          <strong>Schema and samples.</strong> To help you build a model, we read your table and column names, types and
          comments, column statistics, and at most three example values per column (each shortened to 40 characters).
          If you turn on query history, we read only anonymised query shapes from <code>system.query_log</code>, with
          literal values removed.
        </li>
        <li>
          <strong>Request logs.</strong> For each API or MCP call: time, project, dataset, status, duration, row count,
          the key used, and the validated semantic query, which can include filter values. Never response bodies or
          request headers. Your end users are recorded only as a one-way pseudonym.
        </li>
        <li>
          <strong>Assistant chats.</strong> What you type to the AI assistant, its replies, and the query results it
          used (at most 50 rows and 8 KiB per query). We remove things that look like credentials from your messages
          before storing them or sending them to the model.
        </li>
        <li>
          <strong>Usage.</strong> Counts of queries and AI usage per organisation, for plan limits and billing.
        </li>
        <li>
          <strong>Website and product analytics.</strong> Pages visited and clicks, without the text you type. See{' '}
          <a href="#cookies">cookies and analytics</a>.
        </li>
      </ul>

      <h2>Your ClickHouse data</h2>
      <p>
        hypequery Cloud queries your ClickHouse database when you, your API keys or the assistant ask it to, and returns
        the results. We do not copy your tables and we do not cache query results. Your data is stored with us only in
        these places: the example values and statistics on your model draft; aggregate results of measure checks; query
        results inside assistant chats (bounded as above); and filter values in request logs. Each has the retention
        below.
      </p>

      <h2>Why we use it</h2>
      <ul>
        <li>To provide the service you signed up for: sign-in, running queries, the assistant, logs and usage pages. This is necessary to perform our contract with you.</li>
        <li>To keep the service secure, prevent abuse and fix problems. This is our legitimate interest.</li>
        <li>To understand how the product is used and improve it. This is our legitimate interest, and on this website, your consent where cookies are involved.</li>
        <li>To meet our legal obligations.</li>
      </ul>
      <p>We do not sell your data, and we do not use your data or chats to train AI models.</p>

      <h2>The AI assistant</h2>
      <p>
        When you use the assistant, we send Anthropic the conversation, your model, schema metadata, the example values
        your sample policy allows, and query results (bounded as above). We never send credentials or your end users&apos;
        identities. You can exclude columns from what the model sees in your project&apos;s sample policy. Anthropic
        processes this under its commercial terms, which do not allow it to train on API data. [ANTHROPIC RETENTION
        PERIOD / ZERO DATA RETENTION STATUS]
      </p>

      <h2>How long we keep it</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Kept for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Request logs and assistant request logs</td>
            <td>7 days</td>
          </tr>
          <tr>
            <td>Assistant chats</td>
            <td>90 days after last use, or until you delete them</td>
          </tr>
          <tr>
            <td>Models, schema, example values, connection details</td>
            <td>Until you delete the draft, connection or project</td>
          </tr>
          <tr>
            <td>Usage counts and audit log</td>
            <td>13 months</td>
          </tr>
          <tr>
            <td>Account data</td>
            <td>While your account exists</td>
          </tr>
          <tr>
            <td>Sign-in links and sessions</td>
            <td>Until they expire</td>
          </tr>
        </tbody>
      </table>
      <p>
        Deleting a project deletes everything in it. Deleted data can stay in database backups for up to [BACKUP
        RETENTION WINDOW] before it is gone. To delete your account, email{' '}
        <a href="mailto:luke@hypequery.com">luke@hypequery.com</a>.
      </p>

      <h2>Who processes it</h2>
      <p>We use these providers to run the service. Each only processes data to provide its part of it.</p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Purpose</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          {subprocessors.map((row) => (
            <tr key={`${row.name}-${row.purpose}`}>
              <td>{row.name}</td>
              <td>{row.purpose}</td>
              <td>{row.location}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        hypequery Cloud is hosted in the EU. Where a provider processes data outside the EU or UK, such as Anthropic, and
        PostHog for this website&apos;s analytics, in the United States, we rely on Standard Contractual Clauses or an adequacy decision.
      </p>

      <h2 id="cookies">Cookies and analytics</h2>
      <p>
        The app uses a cookie to keep you signed in. On this website, we measure visits with cookieless analytics (Umami
        and PostHog) that store nothing on your device. Google Analytics, PostHog cookies and session recording, and
        Leadfeeder (which identifies visiting companies) run only if you accept them in the cookie banner. You can change
        your choice at any time with the Cookie settings button at the bottom of every page.
      </p>
      <p>
        In the app, PostHog (hosted in the EU) records page views and clicks against your user ID, without page text,
        what you type, or session recordings.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to access, correct, delete or export your personal data, object to or restrict how we use it, and
        withdraw consent. Email <a href="mailto:luke@hypequery.com">luke@hypequery.com</a> and we will reply within a
        month. If your data is in a customer&apos;s
        hypequery project (for example, you are their end user), contact that customer first. You can also complain to
        a data protection authority: in Spain, the Agencia Española de Protección de Datos (AEPD), or the authority
        where you live.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit and at rest. ClickHouse passwords are encrypted with keys in AWS KMS. Access to
        production data is limited to hypequery&apos;s founders.
      </p>

      <h2>Changes</h2>
      <p>
        We will update this page when our practices change, and tell account holders by email about significant
        changes. See also our <Link href="/terms">terms of service</Link>.
      </p>
    </LegalPage>
  );
}
