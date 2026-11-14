import Link from 'next/link';
import { HubFaq, HubSection, HubShell, HubTable } from '@/components/hub-page';
import {
  SemanticLayerGuides,
  SemanticLayerNextStep,
  inlineCode,
  inlineLink,
  spokeArticleJsonLd,
  spokeBreadcrumbs,
  spokeMetadata,
} from '@/components/semantic-layer-parts';
import { marketing } from '@/components/ui/marketing';
import { faqJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

const PATH = '/semantic-layer/agentic-analytics';
const TITLE = 'Agentic Analytics: What It Is and How to Build It';
const DESCRIPTION =
  'Agentic analytics is analytics an AI agent runs: it plans the queries, fetches the numbers and reports back. What it is, three ways to build it, and what to check.';
const UPDATED = updatedFor(PATH);

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const comparisonRows = [
  [
    'Who asks the question',
    'A person, in a dashboard or a query editor',
    'A person in chat, or a goal such as “flag accounts whose usage dropped”',
  ],
  [
    'Who decides what to query',
    'The person, or whoever built the dashboard',
    'The agent, one step at a time, based on what the last result showed',
  ],
  [
    'How many queries per question',
    'Usually one view or one query',
    'Several: the agent checks a total, breaks it down, compares periods',
  ],
  [
    'Where the logic lives',
    'In dashboards, saved queries and analysts’ heads',
    'In tools the agent can call. If the tools are raw SQL, the logic is whatever the agent writes',
  ],
  [
    'What the output is',
    'A chart or a table',
    'An answer, a summary or an action, such as a message, a ticket or an alert',
  ],
];

const buildRows = [
  [
    'Text-to-SQL agent',
    'The agent reads table schemas and writes SQL. A database MCP server or a SQL tool runs it.',
    'Fast to try on data you already understand. Every metric is reinvented per conversation, and access rules depend on the prompt and the database user.',
    'An analyst exploring a warehouse they could query anyway',
  ],
  [
    'BI-vendor agent',
    'The agent built into a BI or warehouse product answers over that product’s models.',
    'Little to build. The agent, the models and the permissions belong to that vendor, and the agent is hard to put inside your own product.',
    'Internal users who already live in that BI tool or warehouse',
  ],
  [
    'Agent over a semantic layer',
    'You define metrics and dimensions once. An MCP server exposes them as tools, and the agent queries them by name.',
    'You write the definitions. In return, the agent’s revenue matches the dashboard’s, and tenant and row rules live in code the agent cannot change.',
    'Agents inside a product, or any agent whose numbers people act on',
  ],
];

const checklistRows = [
  [
    'Named metrics',
    'Can the agent list the metrics and dimensions, with descriptions, and query them by name?',
  ],
  [
    'No free-form SQL',
    'Is there a tool that runs arbitrary SQL? If so, can you leave it off?',
  ],
  [
    'Tenant from the server',
    'Does the tenant come from server config or the caller’s verified credential, and does a query with no tenant fail?',
  ],
  [
    'Bounded results',
    'Are there default and maximum row limits, so a retry loop cannot pull a whole table into the context window?',
  ],
  [
    'Same numbers everywhere',
    'Do the dashboard, the API and the agent read one definition of each metric?',
  ],
  [
    'An audit trail',
    'Can you see which tool calls the agent made and the SQL each one ran?',
  ],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is agentic analytics?',
    answer:
      'Agentic analytics is analytics carried out by an AI agent. Given a question or a goal, the agent decides which data to look at, runs the queries, reads the results, follows up where something looks off, and returns an answer or takes an action. A dashboard shows numbers to a person; an agentic analytics system does the looking.',
  },
  {
    question: 'How is agentic analytics different from text-to-SQL?',
    answer:
      'Text-to-SQL turns one question into one query. Agentic analytics runs a loop: several queries, each chosen from the last result, then a summary or an action. Many agents use text-to-SQL as their query tool, but they can also query named metrics through a semantic layer, which removes the guessing about joins, filters and metric formulas.',
  },
  {
    question: 'Why does agentic analytics need a semantic layer?',
    answer:
      'An agent repeats its work in every conversation. Without fixed definitions, two conversations can compute revenue two ways, and a missing filter can show one customer another customer’s data. A semantic layer gives the agent named metrics and puts tenant and row rules in code, so every query is computed and scoped the same way.',
  },
  {
    question: 'What is the difference between agentic analytics and agentic BI?',
    answer:
      'They are mostly used for the same idea. Agentic BI usually means an agent built into a BI product, answering over that product’s models. Agentic analytics is broader and includes agents you build yourself, inside your own application, over your own data.',
  },
  {
    question: 'Can I build agentic analytics on ClickHouse?',
    answer:
      'Yes. ClickHouse answers the many small aggregate queries an agent makes quickly. For governed access, define the metrics in a semantic layer and expose them over MCP; hypequery does this for ClickHouse from TypeScript or Python, with the tenant taken from the server rather than the agent.',
  },
];

export default function AgenticAnalyticsPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('Agentic analytics')}
      eyebrow="Semantic layer"
      title="Agentic analytics"
      updated={UPDATED}
      lead={
        <p>
          What agentic analytics is, how it differs from dashboards and text-to-SQL, the three ways teams build it, and
          what to check before an agent&rsquo;s numbers reach a customer.
        </p>
      }
      primaryCta={{ href: '#build', label: 'Ways to build it', target: 'agentic_analytics_build' }}
      secondaryCta={{ href: '#checklist', label: 'What to check', target: 'agentic_analytics_checklist' }}
      definition={{
        term: 'What is agentic analytics?',
        body: (
          <>
            <p>
              Agentic analytics is analytics carried out by an AI agent. Given a question (&ldquo;why did signups drop
              last week?&rdquo;) or a standing goal (&ldquo;flag accounts whose usage is falling&rdquo;), the agent
              decides which data to look at, runs the queries, reads the results, follows up where something looks
              off, and returns an answer or takes an action.
            </p>
            <p>
              The agent is only as reliable as the tools it queries through. Over raw SQL, it guesses at joins and
              metric formulas in every conversation. Over a semantic layer, it asks for named metrics that are
              computed, and scoped to the right customer, the same way every time.
            </p>
          </>
        ),
      }}
      jsonLd={[spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: UPDATED }), faqJsonLd(faqItems)]}
    >
      <HubSection
        eyebrow="The difference"
        title="Agentic analytics vs dashboards"
        intro={
          <p>
            A dashboard answers the questions someone thought to ask when they built it. An agent answers the next
            question too, because it chooses its own follow-up queries.
          </p>
        }
      >
        <HubTable
          caption="How agentic analytics differs from dashboards and saved queries"
          columns={['', 'Dashboards and saved queries', 'Agentic analytics']}
          rows={comparisonRows}
        />
      </HubSection>

      <HubSection
        id="build"
        band
        eyebrow="Build options"
        title="Three ways to build agentic analytics"
        intro={
          <p>
            Most systems fall into one of three shapes. They differ in where the definition of each metric lives, and
            in who decides which rows a given user may see.
          </p>
        }
      >
        <HubTable
          caption="Three ways to build agentic analytics"
          columns={['Approach', 'How it works', 'Trade-off', 'Fits']}
          rows={buildRows}
        />
        <p className="mt-4 text-sm leading-6 text-text-muted">
          For the semantic layers and MCP servers in the third row, compared tool by tool, see{' '}
          <Link href="/semantic-layer/ai-agents" className={inlineLink}>
            semantic layers for AI agents
          </Link>{' '}
          and{' '}
          <Link href="/semantic-layer/analytics-mcp-server" className={inlineLink}>
            analytics MCP servers
          </Link>
          .
        </p>
      </HubSection>

      <HubSection
        eyebrow="Architecture"
        title="An agentic analytics stack on governed metrics"
        intro={
          <p>
            The agent never touches the database directly. Each layer has one job, and the rules that matter live
            below the agent, where a prompt cannot change them.
          </p>
        }
      >
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">1. The agent</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Claude, Cursor, Codex or your own agent loop. It plans the questions and calls tools. It holds no
              database credentials.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">2. MCP tools</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              A small set of tools: list metrics, describe one, query by name. In{' '}
              <Link href="/clickhouse-mcp" className={inlineLink}>
                @hypequery/mcp
              </Link>{' '}
              they are <code className={inlineCode}>list_datasets</code>,{' '}
              <code className={inlineCode}>get_dataset_schema</code>, <code className={inlineCode}>query_metric</code>{' '}
              and <code className={inlineCode}>query_dataset</code>.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">3. The semantic layer</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Metric and dimension definitions, the tenant key and row limits, in code. The same definitions serve your
              dashboards and APIs, so the agent&rsquo;s numbers match theirs.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">4. The database</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              An analytical database such as ClickHouse, reached by a read-only user. Agents make many small aggregate
              queries, which is the workload it is built for.
            </p>
          </div>
        </div>
        <p className="mt-6 text-sm leading-6 text-text-muted">
          How the tenant reaches each query, and what to test before launch, is covered in{' '}
          <Link href="/semantic-layer/access-control" className={inlineLink}>
            data access control
          </Link>
          .
        </p>
      </HubSection>

      <HubSection id="checklist" band eyebrow="Before launch" title="Six things to check in an agentic analytics system">
        <HubTable caption="Agentic analytics checklist" columns={['Check', 'Question to ask']} rows={checklistRows} />
      </HubSection>

      <HubSection
        eyebrow="An honest answer"
        title="When you don't need to build it"
        intro={
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Only your own analysts will use the agent, on a warehouse they can already query: a text-to-SQL agent
                or the agent in your BI tool is a fine start.
              </li>
              <li>
                Your metrics already live in a warehouse-native or BI semantic layer: use that layer&rsquo;s MCP server
                rather than defining the metrics a second time.
              </li>
            </ul>
            <p>
              Build it on a semantic layer in your own code when the agent is part of your product: it serves your
              customers, it must only see their data, and its numbers have to match the dashboards they already trust.
            </p>
          </>
        }
      />

      <HubSection eyebrow="Questions" title="Agentic analytics FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <SemanticLayerNextStep location="agentic_analytics_next_step" />
    </HubShell>
  );
}
