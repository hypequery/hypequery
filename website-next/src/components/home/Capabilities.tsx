import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import { QUERY_CODE, DATASET_CODE, SERVE_CODE, MCP_CODE } from './constants';

interface CapabilityCardProps {
  icon: string;
  label: string;
  isNew?: boolean;
  title: string;
  desc: string;
  code: string;
  docsLink: string;
  ctaText: string;
}

function CapabilityCard({ icon, label, isNew, title, desc, code, docsLink, ctaText }: CapabilityCardProps) {
  return (
    <article className="bg-bg-card border border-border rounded-lg overflow-hidden flex flex-col">
      <div className="p-7 pb-4 flex items-start gap-3.5 border-b border-border">
        <div className="w-[38px] h-[38px] rounded-lg grid place-items-center font-mono text-[15px] font-bold bg-accent-soft text-accent shrink-0">
          {icon}
        </div>
        <div>
          <div className="font-mono text-[10.5px] font-semibold tracking-[0.16em] uppercase text-text-muted flex items-center gap-2">
            {label}
            {isNew && (
              <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-accent bg-accent-soft px-1.5 py-0.5 rounded-sm">
                New
              </span>
            )}
          </div>
          <h3 className="mt-1.5 text-h3 text-text">{title}</h3>
          <p className="mt-2 text-body-sm text-text-muted max-w-[420px]">{desc}</p>
        </div>
      </div>
      <div className="min-h-[260px] p-4 flex flex-col">
        <div className="bg-bg-alt flex-1 rounded-lg border border-border px-5 py-4">
          <CodeHighlight
            code={code}
            language="typescript"
            className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.8] h-full"
          />
        </div>
        <Link
          href={docsLink}
          className="mt-3 inline-flex items-center gap-1.5 bg-text text-bg px-4 py-2 text-[13px] font-semibold rounded transition hover:opacity-90 self-start"
        >
          {ctaText} →
        </Link>
      </div>
    </article>
  );
}

export function Capabilities() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[112px] pb-6">
      <div className="mb-12">
        <p className="font-mono text-eyebrow text-accent mb-3.5">What you get</p>
        <h2 className="text-h2 text-text max-w-[780px] text-balance">
          Type-safe queries. Datasets when metrics matter. APIs when you need them.
        </h2>
        <p className="mt-3.5 text-body text-text-muted max-w-[680px] text-pretty">
          You don't adopt a platform. You install a library and use the layer you need — opt in across the stack, in the codebase you already have.
        </p>
      </div>

      <div className="grid-responsive-2 mt-12">
        <CapabilityCard
          icon="Q"
          label="Query builder"
          title="Type-safe queries, backed by your schema"
          desc="Generate types from your schema and build queries with full autocomplete, reusable filters, joins, and strongly typed results."
          code={QUERY_CODE}
          docsLink="/docs/query-building/basics"
          ctaText="Get started with queries"
        />
        <CapabilityCard
          icon="D"
          label="Datasets"
          isNew
          title="Define your table once. Every query inherits it."
          desc="Declare the table, its tenant key, and its time key in one place. Runtime tenant context applies the row filter, and conflicting tenant filters are rejected at runtime. Change the definition once; everything downstream updates."
          code={DATASET_CODE}
          docsLink="/docs/datasets/overview"
          ctaText="Get started with datasets"
        />
        <CapabilityCard
          icon="S"
          label="Serve"
          title="Turn any query into a typed API."
          desc="Pass a query or dataset to serve(). You get a typed REST route, an OpenAPI spec, and a React hook — generated from the definition you already wrote. No controllers, no client codegen step you maintain by hand."
          code={SERVE_CODE}
          docsLink="/docs/serve"
          ctaText="Get started with serve"
        />
        <CapabilityCard
          icon="M"
          label="MCP"
          isNew
          title="Query your datasets with an agent."
          desc="Expose datasets as MCP tools. Agents query typed, governed data — never raw SQL. The dataset layer is the only thing they can touch."
          code={MCP_CODE}
          docsLink="/docs/mcp/overview"
          ctaText="Explore MCP"
        />
      </div>
    </section>
  );
}
