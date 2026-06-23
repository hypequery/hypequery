import React from 'react';
import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import { FEATURE_D_CODE, FEATURE_S_CODE, FEATURE_M_CODE, QUERY_CODE } from './constants';

interface FeatureRowProps {
  icon: string;
  label: string;
  isNew?: boolean;
  kicker: string;
  title: string;
  desc: string;
  code: string;
  fileName: string;
  docsLink: string;
  ctaText: string;
  reverse?: boolean;
  children?: React.ReactNode;
}

function FeatureRow({
  icon,
  label,
  isNew,
  kicker,
  title,
  desc,
  code,
  fileName,
  docsLink,
  ctaText,
  reverse,
  children,
}: FeatureRowProps) {
  return (
    <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
      <div className={reverse ? 'lg:order-2' : ''}>
        <div className="flex items-center gap-3.5">
          <div className="w-[38px] h-[38px] rounded-lg grid place-items-center font-mono text-[15px] font-bold bg-accent-soft text-accent shrink-0">
            {icon}
          </div>
          <div className="font-mono text-[10.5px] font-semibold tracking-[0.16em] uppercase text-text-muted flex items-center gap-2">
            {label}
            {isNew && (
              <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-accent bg-accent-soft px-1.5 py-0.5 rounded-sm">
                New
              </span>
            )}
          </div>
        </div>
        <p className="mt-5 font-mono text-eyebrow text-accent">{kicker}</p>
        <h3 className="mt-2 text-h3 text-text text-balance">{title}</h3>
        <p className="mt-3 text-body text-text-muted text-pretty">{desc}</p>
        {children}
        <Link
          href={docsLink}
          className="mt-6 inline-flex items-center gap-1.5 bg-text text-bg px-4 py-2 text-[13px] font-semibold rounded transition hover:opacity-90"
        >
          {ctaText} →
        </Link>
      </div>

      <div className={`bg-bg-card border border-border rounded-lg overflow-hidden ${reverse ? 'lg:order-1' : ''}`}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="font-mono text-[11px] font-semibold tracking-[0.16em] uppercase text-text-muted">
            {fileName}
          </span>
          <span className="font-mono text-[11px] text-accent">{label}</span>
        </div>
        <div className="bg-bg-alt p-5">
          <CodeHighlight
            code={code}
            language="typescript"
            className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.8]"
          />
        </div>
      </div>
    </div>
  );
}

export function Capabilities() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[112px] pb-6">
      <div className="mb-14 text-center">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Define once, everything inherits</p>
        <h2 className="text-h2 text-text mx-auto max-w-[760px] text-balance">
          One library, four layers. Opt-in across the stack        </h2>
        <p className="mt-3.5 text-body text-text-muted mx-auto max-w-[640px] text-pretty">
          You don&apos;t adopt a platform. You install a library and use the layer you need, in the codebase you already have.
        </p>
      </div>

      <div className="grid gap-20">
        {/* Q — Query builder */}
        <FeatureRow
          icon="Q"
          label="Query builder"
          kicker=""
          title="Type-safe queries, backed by your schema."
          desc="The ClickHouse-native query builder. Generate types from your schema and build queries with full autocomplete, reusable filters, joins, and strongly typed results."
          code={QUERY_CODE}
          fileName="query-builder.ts"
          docsLink="/docs/query-building/basics"
          ctaText="Get started with queries"
        />

        {/* D — Datasets */}
        <FeatureRow
          icon="D"
          label="Datasets"
          isNew
          reverse
          kicker=""
          title="Model your analytics. Multi-tenancy comes as standard."
          desc="Declare the table, its dimensions, and its measures. Name reusable metrics like revenue and orderCount, then compose derived metrics with formula helpers. Call toSQL when you want the exact ClickHouse query."
          code={FEATURE_D_CODE}
          fileName="datasets/orders.ts"
          docsLink="/docs/datasets/overview"
          ctaText="Get started with datasets"
        />

        {/* S — Serve */}
        <FeatureRow
          icon="S"
          label="Serve"
          kicker=""
          title="A typed REST route, an OpenAPI spec, and a React hook."
          desc="Pass datasets or queries to serve(). You get a typed REST route, an OpenAPI spec, and a React hook — all from one definition."
          code={FEATURE_S_CODE}
          fileName="serve/api.ts"
          docsLink="/docs/serve"
          ctaText="Get started with serve"
        />

        {/* M — MCP */}
        <FeatureRow
          icon="M"
          label="MCP"
          isNew
          reverse
          kicker=""
          title="Agents query your data, never your database."
          desc="Expose your dataset registry as MCP tools. Agents can inspect schemas and query datasets or metrics — they cannot write raw SQL or reach tables you didn't expose."
          code={FEATURE_M_CODE}
          fileName="mcp-config.ts"
          docsLink="/docs/mcp/overview"
          ctaText="Explore MCP"
        />


      </div>
    </section>
  );
}
