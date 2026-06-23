import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import { MCP_SECTION_CODE } from './constants';

export function MCP() {
  return (
    <section id="mcp" className="mx-auto max-w-[1280px] px-8 pt-[112px] pb-8 scroll-mt-28">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <p className="font-mono text-eyebrow text-accent mb-3.5">Agent-ready · @hypequery/mcp</p>
          <h2 className="text-h2 text-text max-w-[680px] text-balance">
            Let agents query your data, not your database.
          </h2>
          <p className="mt-4 text-body text-text-muted max-w-[640px] text-pretty">
            Expose your datasets as MCP tools and any agent queries them through the layer you defined. It can inspect schemas and query datasets or metrics, but it cannot write raw SQL or reach tables you did not expose.
          </p>

          <div className="mt-8 grid gap-3">
            <div className="border border-border rounded-lg bg-bg-card p-5">
              <div className="font-mono text-[11px] font-semibold tracking-[0.16em] uppercase text-text-muted">
                Raw SQL to an LLM
              </div>
              <p className="mt-2 text-body-sm text-text-muted">
                Hope it does not hallucinate a bad query, read the wrong table, or bypass the policy you meant to enforce.
              </p>
            </div>
            <div className="border border-accent/30 rounded-lg bg-accent-soft p-5">
              <div className="font-mono text-[11px] font-semibold tracking-[0.16em] uppercase text-accent">
                Datasets as MCP tools
              </div>
              <p className="mt-2 text-body-sm text-text">
                The agent's vocabulary is your governed dataset registry. Nothing else exists.
              </p>
            </div>
          </div>

          <Link
            href="/docs/mcp/overview"
            className="mt-7 inline-flex items-center gap-1.5 bg-text text-bg px-4 py-2 text-[13px] font-semibold rounded transition hover:opacity-90"
          >
            Read the MCP docs →
          </Link>
        </div>

        <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="font-mono text-[11px] font-semibold tracking-[0.16em] uppercase text-text-muted">
              mcp-config.ts
            </span>
            <span className="font-mono text-[11px] text-accent">@hypequery/mcp</span>
          </div>
          <div className="bg-bg-alt p-5">
            <CodeHighlight
              code={MCP_SECTION_CODE}
              language="typescript"
              className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.8]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
