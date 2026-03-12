# Lightweight Blog CMS Architecture

## Current state

- Blog posts live in `content/blog/*.md` and `*.mdx`.
- The site reads frontmatter with `gray-matter` in `src/lib/blog.ts`.
- Blog pages are statically generated from local files.

This is a good foundation, but an in-app editor cannot reliably write to disk in a deployed Next.js app. Vercel-style deployments have read-only runtime filesystems and no persistence across deploys.

## Recommendation

Use a database-backed CMS as the live source of truth for both drafts and published posts.

The existing Markdown files in `content/blog` can still serve as seed content during migration, but they should no longer be the primary runtime store if the goal is to publish without a code push.

## Proposed architecture

### 1. Content model

Keep your current Markdown format and extend frontmatter:

```md
---
title: A guide to materialized views in ClickHouse
description: What they are, when to use them, and where teams get them wrong.
date: 2026-02-01
status: draft
slug: guide-to-materialized-views-in-clickhouse
author: Luke Reilly
tags:
  - clickhouse
  - analytics
seoTitle: A guide to materialized views in ClickHouse
seoDescription: Practical guidance for designing and operating materialized views.
---
```

Suggested statuses:

- `draft`
- `review`
- `scheduled`
- `published`

### 2. Content storage

Store editable drafts and published posts in a small database table instead of the filesystem.

Recommended options:

- Best fit: SQLite with Prisma or Drizzle if you want structured migrations and a small local footprint.
- Lowest-dependency option: SQLite via `better-sqlite3` and a thin repository layer.
- If you want zero database code: GitHub-backed drafts via GitHub API, but this is more operationally fragile than SQLite.

Post record shape:

```ts
type BlogDraft = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: 'draft' | 'review' | 'scheduled' | 'published';
  publishAt: string | null;
  frontmatter: Record<string, unknown>;
  body: string;
  createdAt: string;
  updatedAt: string;
  publishedCommitSha: string | null;
};
```

Why a DB-backed CMS:

- drafts survive deploys
- you can autosave safely
- preview links can resolve unpublished content
- published posts can go live without a redeploy
- you avoid direct git writes from the browser

### 3. Admin surface

Add a private route group:

- `src/app/(cms)/cms/page.tsx`: list drafts and published posts
- `src/app/(cms)/cms/new/page.tsx`: create post
- `src/app/(cms)/cms/[id]/page.tsx`: edit post
- `src/app/(cms)/cms/actions.ts`: server actions for save, publish, archive

UI scope for v1:

- title, slug, description, status
- Markdown editor textarea
- frontmatter fields for SEO and tags
- autosave
- Preview button
- Publish button

Do not build a rich-text editor. Markdown is already your source format and is much cheaper to maintain.

### 4. Authentication

Protect `/cms` with simple session auth.

Good lightweight options:

- Password-only admin login using a signed cookie and `CMS_ADMIN_PASSWORD`
- Better long-term: GitHub OAuth via Auth.js if multiple editors need access

For a single internal team, password + cookie middleware is enough for v1.

### 5. Preview flow

Use Next.js Draft Mode for previews.

Flow:

1. Editor saves a draft to SQLite.
2. Editor clicks Preview.
3. App enables Draft Mode and redirects to `/blog/preview/[slug]` or `/blog/[slug]?preview=1`.
4. Blog loaders merge published Markdown with draft records when Draft Mode is enabled.

Rules:

- Normal visitors only see `published`.
- Draft Mode viewers can see `draft`, `review`, and `scheduled`.
- A draft can override an existing published slug without affecting public traffic.

### 6. Publish flow

Publishing should update the database record directly.

Recommended publish pipeline:

1. Editor clicks Publish.
2. Server action validates the post and sets `status = 'published'`.
3. Public blog routes read the updated record immediately.
4. Optional: emit a background export into Markdown for archival or backup.

This gives you:

- immediate publishing
- no redeploy requirement
- simple rollback by flipping status or restoring a prior revision

### 7. Read-path changes

Refactor `src/lib/blog.ts` into two layers:

- `getPublishedPosts()`: reads the database
- `getDraftPosts()`: reads unpublished records from the database
- `getPosts({ includeDrafts })`: merges them by slug, preferring draft content in preview mode

This keeps the blog routes mostly unchanged.

### 8. Media handling

Do not store images in the DB.

Use one of:

- `public/blog/*` committed through git
- Vercel Blob / S3 for uploads if you need drag-and-drop media

For v1, committed images under `public/blog` are simplest.

## Suggested implementation phases

### Phase 1

- Add frontmatter `status` and explicit `slug`
- Refactor blog loader to support preview-aware reads
- Add `/cms` auth shell
- Add SQLite draft table
- Add create/edit/save draft screens
- Add preview with Draft Mode

### Phase 2

- Add scheduled publish support
- Add revision history
- Add optional Markdown export for backup or git archival

### Phase 3

- Add image uploads
- Add editor roles

## Recommendation on libraries

Avoid building every primitive from scratch. The right line is:

- build the CMS UI and workflow yourself
- use small infrastructure libraries where they remove operational risk

Reasonable additions:

- SQLite driver
- minimal auth/session helper
- optional ORM if you want migrations

Avoid:

- full hosted CMS products
- block editors
- bespoke git plumbing in the browser

## Concrete fit for this repo

Given the current `website-next` app, I would implement:

- a private `/cms` route inside the same Next app
- SQLite-backed posts
- password-based admin auth for v1
- public blog reads from SQLite
- optional preview mode for drafts
- optional Markdown export as a second step, not day one

That is the lowest-complexity system that gives you true draft editing, immediate publishing, and no code-push requirement for editorial updates.
