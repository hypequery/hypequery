import type { Metadata } from 'next';
import Link from 'next/link';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { Cloud } from 'lucide-react';
import { SiPython, SiTypescript } from 'react-icons/si';
import { absoluteUrl, ogImage } from '@/lib/site';

const title = 'hypequery documentation';
const description =
  'Connect your ClickHouse and ship analytics: dashboards, APIs and AI agents for your customers, each seeing only their own data. Define it once in TypeScript or Python and run it in your own backend.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl('/docs') },
  openGraph: { type: 'website', url: absoluteUrl('/docs'), title, description, images: ogImage(title) },
  twitter: { card: 'summary_large_image', title, description },
};

/** The language-neutral docs entry point: what hypequery is, then a choice of TypeScript, Python, or Cloud. */
export default function DocsHome() {
  return (
    <DocsPage>
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription>{description}</DocsDescription>
      <DocsBody>
        <p>
          hypequery is an open-source semantic layer for ClickHouse that runs inside your application. You define
          datasets once: the dimensions people group by, the measures they aggregate, the relationships between tables,
          and the tenant rules that keep each customer to their own rows. Every consumer then queries those
          definitions by name, so a number means the same thing in a dashboard, an API response, and an AI
          agent&apos;s answer.
        </p>
        <p>
          It is a library, not another service to deploy. TypeScript and Python implement the same specifications and
          pass the same conformance fixtures, so equivalent definitions produce the same semantic and deployment
          artifacts in either language.
        </p>

        <h2>Choose your language</h2>
        <Cards>
          <Card
            icon={<SiTypescript className="text-[#3178c6]" />}
            title="TypeScript"
            href="/docs/introduction"
            description="The full toolkit: datasets, a type-safe query builder, Serve APIs for Node, Next.js, Bun, Deno and Workers, typed React hooks, the MCP server, and the CLI."
          />
          <Card
            icon={<SiPython className="text-[#3776ab]" />}
            title="Python (beta)"
            href="/docs/python"
            description="Datasets and Serve for FastAPI, Django, Flask, or any ASGI or WSGI server, typed DataFrames, and the CLI. The same React hooks and MCP server work against it."
          />
          <Card
            icon={<Cloud className="text-fd-primary" />}
            title="Cloud (not live yet)"
            href="/docs/cloud"
            description="A planned hosted service that serves your datasets as REST and MCP endpoints. You can't sign up yet; join the waitlist."
          />
        </Cards>

        <h2>How the pieces fit</h2>
        <ol>
          <li>
            <strong>Define datasets</strong> in code, next to your application, and review them in pull requests
            like any other change.
          </li>
          <li>
            <strong>Query them in-process</strong> from jobs, reports, notebooks, and your own routes, scoped to a
            tenant.
          </li>
          <li>
            <strong>Serve them over HTTP</strong> when another consumer needs them: authenticated endpoints with
            OpenAPI, mounted in the framework you already run.
          </li>
          <li>
            <strong>Connect clients</strong> to those endpoints: typed{' '}
            <Link href="/docs/react/getting-started">React hooks</Link> for dashboards and the{' '}
            <Link href="/docs/mcp/overview">MCP server</Link> for agents. Both work whether the backend is TypeScript or
            Python.
          </li>
        </ol>

        <h2>Learn more</h2>
        <Cards>
          <Card title="Why hypequery" href="/docs/why-hypequery" description="The problem it solves, who it fits, and when to pick something else." />
          <Card title="Core concepts" href="/docs/core-concepts" description="Datasets, serving, and clients, and how they relate." />
        </Cards>
      </DocsBody>
    </DocsPage>
  );
}
