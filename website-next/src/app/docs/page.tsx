import type { Metadata } from 'next';
import Link from 'next/link';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { Bot, Braces, LayoutDashboard, MessagesSquare, Server, Sparkles, Webhook } from 'lucide-react';
import { SiPython, SiTypescript } from 'react-icons/si';
import { Callout } from 'fumadocs-ui/components/callout';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';
import { absoluteUrl, ogImage } from '@/lib/site';

const title = 'hypequery documentation';
const description =
  'A semantic layer for ClickHouse. Define datasets once, with AI or in TypeScript or Python, and serve them to dashboards, APIs, and AI agents from hypequery cloud or your own backend.';

export const metadata: Metadata = {
  // Absolute: the root "%s | hypequery" template would repeat the product name.
  title: { absolute: title },
  description,
  alternates: { canonical: absoluteUrl('/docs') },
  openGraph: { type: 'website', url: absoluteUrl('/docs'), title, description, images: ogImage(title) },
  twitter: { card: 'summary_large_image', title, description },
};

/**
 * The docs entry point, cloud-first: what hypequery is, the cloud quick start, the two ways to model data, what you
 * can build on a release, and then the open-source path for teams that run it themselves.
 */
export default function DocsHome() {
  // No breadcrumb: fumadocs would label the docs root with its first sidebar folder ("Getting started").
  return (
    <DocsPage breadcrumb={{ enabled: false }}>
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription>{description}</DocsDescription>
      <DocsBody>
        <p>
          hypequery is a semantic layer for ClickHouse. You define datasets once: the dimensions people group by, the
          measures they aggregate, the relationships between tables, and the tenant rules that keep each customer to
          their own rows. Every consumer then queries those definitions by name, so a number means the same thing in a
          dashboard, an API response, and an AI agent&apos;s answer.
        </p>
        <p>
          <strong>hypequery cloud</strong> serves your datasets as REST and MCP endpoints, with API keys, tenant
          isolation, and one-click rollback, so there is no server for you to run. The same definitions also run in
          your own backend with the open-source TypeScript and Python SDKs.
        </p>

        <Callout type="warn" title="Cloud is not live yet">
          You can&apos;t sign up for cloud today; the cloud pages describe the planned service. What runs today is the
          open-source SDKs: start with the <Link href="/docs/quick-start">self-host quick start</Link>.{' '}
          <DeployWaitlist location="docs-home" className="font-medium text-fd-primary underline underline-offset-2" />
        </Callout>

        <h2>Get started</h2>
        <Cards>
          <Card
            icon={<Sparkles className="text-fd-primary" />}
            title="Cloud quick start"
            href="/docs/cloud/quick-start"
            description="Connect ClickHouse, model a dataset with AI or in code, deploy it, and query it over REST and MCP."
          />
          <Card
            icon={<Server className="text-fd-primary" />}
            title="Self-host quick start"
            href="/docs/quick-start"
            description="Install the open-source SDK, define a dataset, and query it in-process from your own backend."
          />
        </Cards>

        <h2>Model your data</h2>
        <p>
          Both ways of writing datasets produce the same deployment contract, so cloud serves them the same way and you
          can switch later.
        </p>
        <Cards>
          <Card
            icon={<Sparkles className="text-fd-primary" />}
            title="With AI"
            href="/docs/cloud/ai-authoring"
            description="Cloud's AI reads your schema, learns how your business works, and drafts datasets for you to review."
          />
          <Card
            icon={<SiTypescript className="text-[#3178c6]" />}
            title="In TypeScript"
            href="/docs/datasets/overview"
            description="Datasets, measures, metrics and relationships in code, reviewed in pull requests. Plus a type-safe query builder."
          />
          <Card
            icon={<SiPython className="text-[#3776ab]" />}
            title="In Python (beta)"
            href="/docs/python"
            description="The same datasets for FastAPI, Django, Flask, or any ASGI or WSGI server, with typed DataFrames."
          />
        </Cards>

        <h2>Build on your datasets</h2>
        <Cards>
          <Card
            icon={<Webhook className="text-fd-primary" />}
            title="REST API"
            href="/docs/cloud/rest-api"
            description="One endpoint per published dataset, for dashboards, apps, and integrations."
          />
          <Card
            icon={<Bot className="text-fd-primary" />}
            title="MCP for AI agents"
            href="/docs/cloud/mcp"
            description="Claude, Cursor and other agents query named measures instead of writing SQL."
          />
          <Card
            icon={<LayoutDashboard className="text-fd-primary" />}
            title="React dashboards"
            href="/docs/cloud/react"
            description="Typed hooks on published datasets, each customer seeing only their own rows."
          />
          <Card
            icon={<MessagesSquare className="text-fd-primary" />}
            title="AI in your product"
            href="/docs/cloud/ai-sdk"
            description="Build an agent with the AI SDK, or embed cloud's assistant for each of your users."
          />
        </Cards>

        <h2>Run it yourself</h2>
        <p>
          Everything cloud serves is built on Apache 2.0 SDKs. Self-host to keep the semantic layer in-process, run in
          your own network, or extend the HTTP layer with your own middleware.
        </p>
        <Cards>
          <Card
            icon={<Server className="text-fd-primary" />}
            title="Self-hosting"
            href="/docs/self-hosting"
            description="What you operate yourself, and how each cloud feature maps to an open-source package."
          />
          <Card
            icon={<Braces className="text-fd-primary" />}
            title="Serve your own API"
            href="/docs/quick-start/api-and-dashboard"
            description="Authenticated endpoints with OpenAPI, mounted in Next.js, Node, FastAPI, Django or Flask."
          />
        </Cards>

        <h2>Learn more</h2>
        <Cards>
          <Card title="What is hypequery" href="/docs/what-is-hypequery" description="A precise definition, the packages, how it compares, and release status." />
          <Card title="Core concepts" href="/docs/core-concepts" description="Datasets, serving, and clients, and how they relate." />
          <Card title="How cloud works" href="/docs/cloud/how-it-works" description="From dataset definitions to a live, versioned release." />
        </Cards>
      </DocsBody>
    </DocsPage>
  );
}
