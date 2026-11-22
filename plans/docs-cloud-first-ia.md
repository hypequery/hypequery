# Docs IA: cloud as the main path

Status: implemented in `website-next/docs` (sidebar, landing page, cloud quick start, self-hosting overview, limits).
Cloud is still pre-launch, so every cloud page keeps `<CloudWaitlistNotice />` and the landing page keeps a waitlist
callout. Launch work is listed at the end.

## What was wrong

- **Cloud came last.** The root sidebar order was Getting started → TypeScript SDK → Python SDK → Connect → Cloud. The
  `/docs` landing page described hypequery as "a library, not another service to deploy" and listed Cloud as the
  third language choice.
- **The quick start assumed self-hosting.** "Quick start" in Getting started was the SDK install-and-query page. The
  cloud quick start was a five-bullet stub buried as the fourth item in the Cloud section.
- **Self-hosting had no home.** Serve lived inside the TypeScript SDK, Python Serve inside the Python SDK, and the
  self-hosted MCP server, agent tools, and React hooks in a "Connect" section. Readers couldn't see what they would run
  themselves, or how each cloud feature maps to an open-source package.
- **No limits page.** Cloud limits were spread across Security, REST API, API keys, MCP, CLI, and Chat embed.

## What comparable companies do

The research read each company's docs navigation config and its home, quick start, and self-hosting pages from their
public GitHub repos. The live sites were unreachable from the research environment.

| Company | Cloud vs OSS | Where self-hosting lives | Quick start |
| --- | --- | --- | --- |
| Cube | Cloud by default | A separate "Cube Core" tab, plus "Migrate from Cube Core" in Getting started | Cloud UI flow: connect data, then explore |
| Trigger.dev | Cloud by default | A "Self-hosting" group near the bottom of the sidebar, with a "Should you self-host?" section and a Cloud vs self-hosted table | "Under 3 minutes": sign up for Cloud ("or self-host"), CLI init, dev, run |
| Supabase | Hosted by default | Self-Hosting under "Build", listing platform features you lose and a responsibilities checklist | Per-framework pages, starting in the hosted dashboard |
| Inngest | Cloud for production, local dev first | "Self-host Inngest", the last item in "Platform & operations" | Local Dev Server, then "connect to Inngest Cloud" |
| PostHog | Cloud by default | "Self-host & deploy" with a disclaimer and Migrate guides | One install page with tabs |
| Convex | Cloud implied (`npx convex dev` creates a project) | A single short page under Guides: "not for everyone" | Per-framework steps |
| Prefect | Cloud first | Parallel "Prefect Cloud" and "Prefect Self-hosted" how-to groups | Tabs: "Cloud" first, then "Open Source" |
| Langfuse | Cloud first | A top-level `/self-hosting` section | "The instrumentation code is the same for both" |

Patterns that recur:

1. The default quick start is the cloud one. It says once, up front, that the code is the same for open source.
2. Self-hosting is one clearly labelled section late in the nav. Its overview has a "should you self-host?" part, a
   Cloud vs self-hosted table, and the responsibilities you take on.
3. Getting started has a limits page (Trigger.dev, Cube, Inngest).
4. There is a "migrate to cloud" bridge (Cube, PostHog, Supabase).
5. The docs home has "choose your path" cards rather than a page of prose (Trigger.dev, PostHog, Convex, Supabase).
6. Each language has its own reference tree; the quick start covers languages with tabs (Supabase, Inngest, PostHog,
   Prefect).
7. Account and operations docs (keys, security, monitoring, teams) are grouped together (Cube Admin, Supabase Manage,
   Inngest Platform & operations).
8. Pages say on the page itself when a feature is cloud-only or limited to some plans (Cube callouts, Langfuse
   `AvailabilityBanner`).

## New structure

No URL changed. Every move is between route-group folders, and `(group)` segments don't appear in URLs.

```
Getting started          (open by default)
  Overview               /docs: cloud-first cards, waitlist callout, "Run it yourself" section
  What is hypequery · Core concepts · Why hypequery
  — Quick start —
  Quick start            /docs/cloud/quick-start: rewritten as a full six-step flow
  Self-host quick start  → /docs/quick-start
Cloud                    (open by default)
  Introduction · How it works · Quick start
  — Model & deploy —     AI authoring, Deploy from TypeScript/Python/CI, Releases
  — Query your data —    REST, MCP, React, Python, AI SDK, In-app agents, Chat embed
  — Access & security —  API keys & tenants, ClickHouse users, Security, Limits (new)
  — Manage —             Teams, Logs & usage
  — Reference —          CLI, Cloud operation commands, Portable runtime
— Build with the SDKs —
TypeScript SDK           Get started, Datasets (now before the query builder), Query builder, Reference
Python SDK               unchanged
— Run it yourself —
Self-hosting
  Overview               /docs/self-hosting (new): what you run, Cloud vs self-hosted table, moving between them
  — Quick starts —       Model your data, Serve an API and a dashboard, MCP, AI chat
  — Serve your datasets — TypeScript Serve (moved from the TypeScript SDK), → Python Serve
  — Clients —            MCP server, In-app agents, React hooks (moved from "Connect")
```

Decisions:

- **The SDKs stay between Cloud and Self-hosting.** Unlike Trigger.dev, where the SDK is only how you use the cloud,
  hypequery's dataset modeling serves both paths: you deploy code-defined datasets to cloud. So the SDK trees are
  "Build with the SDKs", and only what you run yourself (Serve, the self-hosted MCP server, agents, and React) moved to
  Self-hosting.
- **Python Serve stays inside the Python SDK.** Python's tree interleaves datasets, frameworks, and serve. Splitting it
  costs more than it gains while Python is in beta, so Self-hosting links to it instead.
- **There is no site-wide Cloud/OSS toggle.** None of the companies above has one. The cloud quick start uses tabs for
  authoring (With AI / TypeScript / Python), as Prefect and PostHog do.

## Follow-ups

- **Launch flip.** Remove `<CloudWaitlistNotice />` from the cloud pages, or make it render nothing. Also remove the
  waitlist callout on `/docs` and the "not live" wording in the cloud page prose, `llms.txt` (`SECTION_TITLES.cloud`
  and the intro line), and `what-is-hypequery`. Add `/docs/cloud/quick-start` to `START_HERE` in `llms.txt`, and add a
  "Sign up" call to action in the docs navbar (Cube does this).
- **Migrate to cloud guide.** Write a page on taking an existing self-hosted Serve app to cloud: `publishToCloud`
  around existing datasets, mapping Serve auth and tenancy to API keys, and moving clients over (Cube, PostHog).
- **Cloud-only markers.** Add a small "Cloud only" badge component for AI authoring, Chat embed, Teams, and Releases,
  and a "Self-hosted" badge for the Serve pages (Cube, Langfuse).
- **Agent setup prompt.** Add a copyable "set up hypequery with your coding agent" prompt at the top of the cloud quick
  start once onboarding is live (Trigger.dev, Supabase, Convex).
- **Self-host production checklist.** Cover auth, tenant resolution, rate limits, and observability (Supabase's
  "Your responsibilities").
